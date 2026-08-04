#!/usr/bin/env python3
"""
SWE-bench Verified Runner for tiny-coding-agent.

Iterates over SWE-bench Verified task instances, runs `tiny-agent run` in each
repository checkout, and collects the resulting patches into a predictions.jsonl
file suitable for the official SWE-bench evaluation harness.

Usage:
    python3 scripts/swe_bench_runner.py [--max-instances N] [--model MODEL]
                                        [--dataset DATASET] [--output FILE]
                                        [--work-dir DIR] [--start-idx N]
                                        [--resume] [--parallel N] [--timeout N]
                                        [--dry-run] [--evaluate]

Requirements:
    pip install datasets
    docker  # for the official SWE-bench evaluation harness (after predictions)

Note: Concurrent prediction writes use fcntl file locking (Unix-only).
      SWE-bench evaluation is Linux-centric, so this is not a limitation in
      practice.
"""

import argparse
import fcntl
import json
import logging
import os
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("swebench-runner")

# ─── Defaults ───────────────────────────────────────────────────────────────

DEFAULT_DATASET = "SWE-bench/SWE-bench_Verified"
DEFAULT_OUTPUT = "predictions.jsonl"
DEFAULT_WORK_DIR = "/tmp/swe-bench-work"
DEFAULT_MODEL = ""  # Use tiny-agent's default model

# ─── Helpers ────────────────────────────────────────────────────────────────


def load_instances(dataset_name: str, max_instances: int | None = None, start_idx: int = 0):
    """Load task instances from Hugging Face."""
    try:
        from datasets import load_dataset
    except ImportError:
        log.error(
            "The 'datasets' library is required. Install it with:\n"
            "  pip install datasets"
        )
        sys.exit(1)

    log.info("Loading dataset: %s", dataset_name)
    dataset = load_dataset(dataset_name, split="test")
    total = len(dataset)
    log.info("Dataset loaded: %d instances total", total)

    instances = list(dataset)
    if start_idx > 0:
        instances = instances[start_idx:]
        log.info("Starting from index %d (%d remaining)", start_idx, len(instances))
    if max_instances is not None:
        instances = instances[:max_instances]
        log.info("Limited to %d instances", len(instances))

    return instances


def load_existing_predictions(output_path: str) -> dict[str, dict]:
    """Load existing predictions from the output file for resume support."""
    predictions: dict[str, dict] = {}
    if not os.path.exists(output_path):
        return predictions

    with open(output_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                pred = json.loads(line)
                instance_id = pred.get("instance_id")
                if instance_id:
                    predictions[instance_id] = pred
            except json.JSONDecodeError:
                log.warning("Skipping malformed line in predictions file")
    return predictions


def clone_or_update_repo(workspace: Path, repo: str, instance_id: str) -> Path:
    """
    Clone the repository into a per-instance isolated directory.

    Each instance gets its own checkout at ``workspace/<instance_id>/repo`` so
    that parallel workers never share a git working tree.
    """
    instance_dir = workspace / instance_id
    repo_dir = instance_dir / "repo"
    if repo_dir.exists():
        log.info("  Repo exists, fetching...")
        subprocess.run(
            ["git", "-C", str(repo_dir), "fetch", "--all"],
            capture_output=True,
            check=False,
        )
    else:
        instance_dir.mkdir(parents=True, exist_ok=True)
        log.info("  Cloning %s...", repo)
        url = f"https://github.com/{repo}.git"
        subprocess.run(
            ["git", "clone", url, str(repo_dir)],
            capture_output=True,
            check=True,
        )
    return repo_dir


def checkout_commit(repo_dir: Path, commit_hash: str):
    """Checkout a specific commit."""
    subprocess.run(
        ["git", "-C", str(repo_dir), "reset", "--hard", commit_hash],
        capture_output=True,
        check=True,
    )
    # Clean up any untracked files from previous runs
    subprocess.run(
        ["git", "-C", str(repo_dir), "clean", "-fd"],
        capture_output=True,
        check=False,
    )


def run_tiny_agent(
    repo_dir: Path,
    problem_statement: str,
    instance_id: str,
    model: str = "",
    timeout_minutes: int = 30,
) -> str | None:
    """
    Run tiny-agent against a SWE-bench instance.

    Returns the git diff (patch) produced by the agent, or None on failure.
    The patch includes staged, unstaged, *and* untracked new files by staging
    everything with ``git add -A`` before producing ``git diff --cached``.
    """
    # Write the problem statement to a temp file (absolute path for safety)
    prompt_path = f"/tmp/swe_prompt_{instance_id}.md"
    try:
        with open(prompt_path, "w") as f:
            f.write(problem_statement)

        cmd = ["tiny-agent", "--allow-all", "run"]
        if model:
            cmd.extend(["--model", model])
        cmd.append(f"Solve the issue described in {prompt_path}")

        log.info("  Running tiny-agent (timeout=%dmin)...", timeout_minutes)

        try:
            result = subprocess.run(
                cmd,
                cwd=str(repo_dir),
                capture_output=True,
                text=True,
                timeout=timeout_minutes * 60,
            )
        except subprocess.TimeoutExpired:
            log.warning("  Timed out after %d minutes", timeout_minutes)
            return None

        if result.returncode != 0:
            log.warning(
                "  tiny-agent exited with code %d. stderr: %s",
                result.returncode,
                result.stderr[-500:],
            )
            return None

        # Stage all changes (including untracked new files) then produce a
        # cached diff so new files appear in the patch. Fail the instance if
        # staging or diff capture fails — do not treat errors as empty patches.
        add_result = subprocess.run(
            ["git", "-C", str(repo_dir), "add", "-A"],
            capture_output=True,
            text=True,
            check=False,
        )
        if add_result.returncode != 0:
            log.warning(
                "  git add -A failed (exit %d): %s",
                add_result.returncode,
                (add_result.stderr or add_result.stdout or "")[-500:],
            )
            return None

        diff_result = subprocess.run(
            ["git", "-C", str(repo_dir), "diff", "--cached", "--binary"],
            capture_output=True,
            text=True,
            check=False,
        )
        if diff_result.returncode != 0:
            log.warning(
                "  git diff --cached failed (exit %d): %s",
                diff_result.returncode,
                (diff_result.stderr or diff_result.stdout or "")[-500:],
            )
            return None

        patch = diff_result.stdout or ""

        if not patch:
            log.info("  No changes produced by agent")
            return ""

        log.info("  Patch produced: %d lines", len(patch.splitlines()))
        return patch
    finally:
        # Clean up the prompt file regardless of success or failure
        try:
            os.unlink(prompt_path)
        except OSError:
            pass


def append_prediction(output_path: str, instance_id: str, model_name: str, patch: str | None):
    """
    Append a prediction to the JSONL output file.

    Uses an fcntl exclusive lock so concurrent workers (in ``--parallel`` mode)
    never interleave writes.  fcntl is Unix-only; SWE-bench runs on Linux so
    this is acceptable.
    """
    pred = {
        "instance_id": instance_id,
        "model_name_or_path": model_name,
        "model_patch": patch or "",
    }
    line = json.dumps(pred) + "\n"
    with open(output_path, "a") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        try:
            f.write(line)
            f.flush()
        finally:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def process_instance(
    instance: dict,
    workspace: Path,
    model: str,
    output_path: str,
    model_name: str,
    timeout_minutes: int,
    instance_num: int,
    total: int,
) -> tuple[str, str | None]:
    """Process a single SWE-bench instance. Returns (instance_id, patch_or_None)."""
    instance_id = instance["instance_id"]
    repo = instance["repo"]
    base_commit = instance["base_commit"]
    problem_statement = instance["problem_statement"]

    log.info(
        "[%d/%d] %s — %s @ %s",
        instance_num,
        total,
        instance_id,
        repo,
        base_commit[:7],
    )

    try:
        # Clone/update repo and checkout base commit (per-instance isolated dir)
        repo_dir = clone_or_update_repo(workspace, repo, instance_id)
        checkout_commit(repo_dir, base_commit)

        # Run tiny-agent
        patch = run_tiny_agent(
            repo_dir,
            problem_statement,
            instance_id,
            model=model,
            timeout_minutes=timeout_minutes,
        )

        # Append to predictions file immediately (lock-protected)
        append_prediction(output_path, instance_id, model_name, patch)
        log.info("  ✅ [%d/%d] %s saved", instance_num, total, instance_id)

        return instance_id, patch

    except subprocess.CalledProcessError as e:
        log.error("  ❌ [%d/%d] Git operation failed: %s", instance_num, total, e)
        append_prediction(output_path, instance_id, model_name, None)
        return instance_id, None

    except Exception as e:
        log.error("  ❌ [%d/%d] Unexpected error: %s", instance_num, total, e)
        append_prediction(output_path, instance_id, model_name, None)
        return instance_id, None


def print_summary(
    results: dict[str, str | None],
    total: int,
    duration_seconds: float,
    output_path: str,
    parallel: int = 1,
):
    """Print a summary of the run."""
    resolved = sum(1 for r in results.values() if r)
    failed_unpatched = sum(1 for r in results.values() if r == "")
    errors = sum(1 for r in results.values() if r is None)
    skipped = sum(1 for r in results.values() if r == "__SKIPPED__")

    log.info("=" * 50)
    log.info("RUN COMPLETE")
    log.info("  Total instances processed: %d", total)
    log.info("  Patches produced:          %d", resolved)
    log.info("  No changes (empty patch):  %d", failed_unpatched)
    log.info("  Errors (no patch):         %d", errors)
    if skipped:
        log.info("  Skipped (already done):    %d", skipped)
    log.info("  Duration:                  %.1f min", duration_seconds / 60)
    if parallel > 1:
        log.info("  Parallel workers:          %d", parallel)
    log.info("  Predictions file:          %s", output_path)
    log.info("=" * 50)


def print_evaluate_command(dataset: str, output_path: str):
    """Print the official SWE-bench harness evaluation command."""
    print()
    print("To evaluate predictions with the official SWE-bench harness:")
    print("  git clone https://github.com/swe-bench/SWE-bench.git")
    print("  cd SWE-bench && pip install -e .")
    print()
    print("  python -m swebench.harness.run_evaluation \\")
    print(f"    --dataset_name {dataset} \\")
    print(f"    --predictions_path {output_path} \\")
    print("    --max_workers 8 \\")
    print("    --run_id tiny-agent-verified")


# ─── Main ───────────────────────────────────────────────────────────────────


def check_tiny_agent() -> None:
    """Verify tiny-agent is installed and accessible."""
    try:
        result = subprocess.run(
            ["tiny-agent", "--help"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            log.error(
                "tiny-agent returned exit code %d. Is it installed and configured?",
                result.returncode,
            )
            sys.exit(1)
    except FileNotFoundError:
        log.error(
            "tiny-agent not found in PATH. Install from https://github.com/jellydn/tiny-coding-agent"
        )
        sys.exit(1)
    except subprocess.TimeoutExpired:
        log.warning("tiny-agent --help timed out — proceeding anyway")


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser (extracted for testability)."""
    parser = argparse.ArgumentParser(
        description="Run tiny-coding-agent against SWE-bench Verified.",
    )
    parser.add_argument(
        "--max-instances",
        type=int,
        default=None,
        help="Maximum number of instances to process (default: all)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help="Model to use (default: tiny-agent's default)",
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default=DEFAULT_DATASET,
        help="Hugging Face dataset name (default: %(default)s)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=DEFAULT_OUTPUT,
        help="Output predictions file (default: %(default)s)",
    )
    parser.add_argument(
        "--work-dir",
        type=str,
        default=DEFAULT_WORK_DIR,
        help="Working directory for repo checkouts (default: %(default)s)",
    )
    parser.add_argument(
        "--start-idx",
        type=int,
        default=0,
        help="Start index in the dataset (default: 0)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from existing predictions file (skip completed instances)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="Timeout per instance in minutes (default: %(default)s)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print instances that would be processed without running tiny-agent",
    )
    parser.add_argument(
        "--parallel",
        type=int,
        default=1,
        help="Number of parallel workers (default: 1, sequential). "
        "Set higher to process multiple instances concurrently. "
        "Each worker uses an isolated per-instance checkout.",
    )
    parser.add_argument(
        "--evaluate",
        action="store_true",
        help="Print the official SWE-bench harness evaluation command after the run",
    )
    return parser


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse and validate command-line arguments (extracted for testability)."""
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.parallel < 1:
        log.error("--parallel must be a positive integer (>= 1)")
        sys.exit(1)
    return args


def main(argv: list[str] | None = None):
    args = parse_args(argv)

    # ── Load dataset ────────────────────────────────────────────────────
    instances = load_instances(args.dataset, args.max_instances, args.start_idx)
    if not instances:
        log.warning("No instances to process")
        return

    # ── Load existing predictions for resume support ────────────────────
    existing = {}
    if args.resume:
        existing = load_existing_predictions(args.output)
        skipped = [i for i in instances if i["instance_id"] in existing]
        if skipped:
            log.info(
                "Resume mode: skipping %d already-completed instances",
                len(skipped),
            )
            instances = [i for i in instances if i["instance_id"] not in existing]

    if args.dry_run:
        log.info("DRY RUN — would process %d instances:", len(instances))
        for inst in instances:
            print(f"  {inst['instance_id']}: {inst['repo']} @ {inst['base_commit']}")
        if args.evaluate:
            output_path = os.path.abspath(args.output)
            print_evaluate_command(args.dataset, output_path)
        return

    check_tiny_agent()

    # ── Prepare workspace ───────────────────────────────────────────────
    workspace = Path(args.work_dir)
    workspace.mkdir(parents=True, exist_ok=True)
    output_path = os.path.abspath(args.output)
    log.info("Workspace: %s", workspace)
    log.info("Output:    %s", output_path)
    if args.parallel > 1:
        log.info("Parallel:  %d workers (isolated checkouts)", args.parallel)

    # Determine model name for predictions file
    model_name = args.model or "tiny-agent"

    # ── Filter instances ────────────────────────────────────────────────
    to_process: list[tuple[int, dict]] = []
    results: dict[str, str | None] = {}

    for idx, instance in enumerate(instances):
        instance_id = instance["instance_id"]
        if instance_id in existing:
            results[instance_id] = "__SKIPPED__"
            continue
        to_process.append((idx + 1, instance))

    # ── Process instances ───────────────────────────────────────────────
    start_time = time.time()

    if args.parallel <= 1:
        # Sequential mode
        for instance_num, instance in to_process:
            instance_id = instance["instance_id"]
            results[instance_id] = process_instance(
                instance, workspace, args.model, output_path,
                model_name, args.timeout, instance_num, len(instances),
            )[1]
    else:
        # Parallel mode — each worker runs in a separate process with its own
        # isolated per-instance checkout directory.  Prediction writes are
        # serialised via fcntl file locking in append_prediction().
        log.info("Processing %d instances with %d workers...", len(to_process), args.parallel)

        with ProcessPoolExecutor(max_workers=args.parallel) as executor:
            future_to_id = {}
            for instance_num, instance in to_process:
                future = executor.submit(
                    process_instance,
                    instance, workspace, args.model, output_path,
                    model_name, args.timeout, instance_num, len(instances),
                )
                future_to_id[future] = instance["instance_id"]

            completed = 0
            for future in as_completed(future_to_id):
                instance_id = future_to_id[future]
                try:
                    _, patch = future.result()
                    results[instance_id] = patch
                except Exception as e:
                    log.error("  ❌ Worker failed for %s: %s", instance_id, e)
                    results[instance_id] = None

                completed += 1
                if completed % 10 == 0 or completed == len(to_process):
                    log.info("Progress: %d/%d completed", completed, len(to_process))

    # ── Summary ─────────────────────────────────────────────────────────
    duration = time.time() - start_time
    print_summary(results, len(instances), duration, output_path, args.parallel)

    if args.evaluate:
        print_evaluate_command(args.dataset, output_path)


if __name__ == "__main__":
    main()
