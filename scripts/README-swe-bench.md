# SWE-bench Runner for tiny-coding-agent

This script runs `tiny-agent` against the [SWE-bench Verified](https://www.swebench.com/) benchmark, collecting patches into a `predictions.jsonl` file for evaluation via the official [SWE-bench harness](https://github.com/swe-bench/SWE-bench).

## Requirements

- Python 3.10+
- `pip install datasets`
- `tiny-agent` installed and authenticated (with a configured provider)
- ~120 GB free disk for Docker images (harness) + repo checkouts
- Linux x86_64 recommended (macOS ARM has experimental support)
- **Unix** required for `--parallel` mode (uses `fcntl` file locking)

## Usage

### 1. Run a dry-run to see what would be processed

```bash
python3 scripts/swe_bench_runner.py --dry-run --max-instances 3
```

### 2. Run the agent against instances

```bash
# Process 5 instances with default model
python3 scripts/swe_bench_runner.py --max-instances 5

# Use a specific model
python3 scripts/swe_bench_runner.py --max-instances 5 --model claude-sonnet-4-20250514

# Process all 500 instances (will take a long time)
python3 scripts/swe_bench_runner.py

# Resume from where you left off
python3 scripts/swe_bench_runner.py --resume

# Start from a specific index (e.g., skip first 100)
python3 scripts/swe_bench_runner.py --start-idx 100
```

### 3. Run in parallel

```bash
# Process instances with 4 parallel workers
python3 scripts/swe_bench_runner.py --parallel 4 --max-instances 20
```

> **⚠️ Warning:** Each parallel worker clones its own repository checkout and
> runs a separate `tiny-agent` process.  Increasing `--parallel` multiplies
> disk usage (one full clone per instance) and API rate consumption.  Start
> with `--parallel 2` and monitor your provider's rate limits before scaling
> up.

Each worker uses an **isolated per-instance checkout** at
`<work-dir>/<instance_id>/repo`.  This means parallel workers never share a
git working tree, so there are no race conditions on `git checkout`,
`git add`, or `git diff`.

### 4. Evaluate predictions with the official SWE-bench harness

```bash
git clone https://github.com/swe-bench/SWE-bench.git
cd SWE-bench
pip install -e .

python -m swebench.harness.run_evaluation \
  --dataset_name SWE-bench/SWE-bench_Verified \
  --predictions_path ../predictions.jsonl \
  --max_workers 8 \
  --run_id tiny-agent-verified
```

Alternatively, pass `--evaluate` to the runner and it will print the exact
harness command with your output path filled in:

```bash
python3 scripts/swe_bench_runner.py --max-instances 5 --evaluate
```

## Script Options

| Flag | Default | Description |
|------|---------|-------------|
| `--max-instances N` | all | Process only the first N instances |
| `--model MODEL` | default | Model override for tiny-agent |
| `--dataset NAME` | `SWE-bench/SWE-bench_Verified` | Hugging Face dataset |
| `--output FILE` | `predictions.jsonl` | Output predictions file |
| `--work-dir DIR` | `/tmp/swe-bench-work` | Directory for repo checkouts |
| `--start-idx N` | 0 | Start index in the dataset |
| `--resume` | false | Skip already-completed instances |
| `--timeout N` | 30 | Timeout per instance (minutes) |
| `--dry-run` | false | Print instances without running |
| `--parallel N` | 1 | Number of parallel workers (each with isolated checkout) |
| `--evaluate` | false | Print the SWE-bench harness evaluation command after the run |

## Output Format

The predictions file follows the [SWE-bench prediction format](https://github.com/swe-bench/SWE-bench/blob/main/README.md#predictions):

```jsonl
{"instance_id": "sympy__sympy-20590", "model_name_or_path": "tiny-agent", "model_patch": "diff --git a/..."}
{"instance_id": "django__django-11099", "model_name_or_path": "tiny-agent", "model_patch": "diff --git a/..."}
```

## Patch Generation

After `tiny-agent` completes, the runner stages **all** changes (including
untracked new files) with `git add -A` and then produces the patch via
`git diff --cached`.  This ensures that new files created by the agent are
included in the patch, which is the standard SWE-bench pattern.

Both `git add -A` and `git diff --cached` are checked for non-zero exit codes.
If either command fails (e.g. permissions, disk exhaustion, index errors), the
instance is recorded as an error (the runner returns `None` and appends an empty
patch), rather than silently emitting an empty patch as if the agent made no
changes. A truly empty working tree still yields an empty-string patch, which is
reported separately as a "no changes" outcome.

## Concurrency Safety

In `--parallel` mode, each worker:

1. Clones into its own `<work-dir>/<instance_id>/repo` directory (no shared
   working trees).
2. Appends predictions to the shared output file using an `fcntl` exclusive
   lock (`LOCK_EX`), so writes from different processes never interleave.

`fcntl` is Unix-only; SWE-bench evaluation is Linux-centric, so this is not a
practical limitation.

## GitHub Actions

A gated workflow at [`.github/workflows/swe-bench.yml`](../.github/workflows/swe-bench.yml)
runs the SWE-bench runner in CI. It is **never** triggered by an ordinary push
to `main` or a plain PR open — it only runs under the conditions below. The
expensive benchmark job uses the GitHub Environment `swe-bench`; with
**Required reviewers** configured on that environment (see setup below), runs
pause for approval before spending API credits.

### When it runs

| Trigger                          | Behavior                                    | Approval required |
| -------------------------------- | ------------------------------------------- | ----------------- |
| PR labeled `benchmark`           | Smoke run (5 instances), `dry_run=false`    | Yes (`swe-bench`) |
| Release published                | Smoke/medium run (10 instances)             | Yes (`swe-bench`) |
| Manual `workflow_dispatch`       | Custom inputs (instances, model, dry-run…)  | Yes (`swe-bench`) |
| Push to `main` / ordinary PR     | **Does not run**                            | n/a               |

The workflow has three jobs:

1. **Prepare** — gated by the trigger rules above; resolves run parameters and
   rejects fork PRs (no secrets available). No approval needed.
2. **Runner unit tests** — runs `python3 -m unittest scripts/test_swe_bench_runner.py`.
   Cheap; no approval needed.
3. **Run SWE-bench** — the real benchmark. Has `environment: swe-bench`, so it
   targets environment `swe-bench` (configure **Required reviewers** on that
   environment so runs pause for approval before spending API credits). Builds
   `tiny-agent`, installs Python deps, runs the runner, and uploads
   `predictions.jsonl` as an artifact (`swe-bench-predictions-<run_id>`,
   30-day retention).

### One-time setup (repo admin)

1. Create a GitHub **Environment** named **`swe-bench`**
   (repo → Settings → Environments → New environment).
2. Enable **Required reviewers** on that environment and add yourself / the
   maintainers — this is the approval gate that prevents unattended API spend.
3. Add provider API keys as **environment secrets** on `swe-bench` (preferred)
   or as repository secrets. At least one is required for non-dry-run jobs:
   - `OPENROUTER_API_KEY` (**primary secret for CI testing**)
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `OPENCODE_API_KEY`
   - `ZAI_API_KEY`
   The workflow writes only providers with configured secrets to its temporary
   CI config and references each key with `${VAR}` environment interpolation.
4. Create a repo **label** named exactly **`benchmark`** (Issues → Labels →
   New label).
5. (Optional) Restrict the `swe-bench` environment to the `main` branch for
   extra safety.

### How to trigger on a PR

1. Open or update the PR (from a branch in this repo — fork PRs are rejected).
2. Add the **`benchmark`** label.
3. When the `Run SWE-bench` job reaches the `swe-bench` environment, **approve**
   the pending deployment when prompted.
4. Download the `swe-bench-predictions-<run_id>` artifact when the run finishes
   and evaluate locally with the harness (see below).

### Manual run (`workflow_dispatch`)

Repo → Actions → **SWE-bench** → Run workflow. Inputs:

| Input             | Default | Description                                  |
| ----------------- | ------- | -------------------------------------------- |
| `max_instances`   | `5`     | Max SWE-bench instances to process           |
| `model`           | `poolside/laguna-s-2.1:free@openrouter` | OpenRouter free model; empty uses the same default |
| `parallel`        | `1`     | Parallel workers                             |
| `timeout_minutes` | `30`    | Per-instance timeout (minutes)               |
| `dry_run`         | `false` | Dry-run only (no tiny-agent / no API calls)  |
| `evaluate_hint`   | `true`  | Print harness evaluate command after run     |

The CI default is `poolside/laguna-s-2.1:free@openrouter`, using the
`OPENROUTER_API_KEY` secret. Other suggested models from OpenRouter's
[free model collection](https://openrouter.ai/collections/free-models) are:

| Model | Notes |
| ----- | ----- |
| `poolside/laguna-s-2.1:free@openrouter` | Primary default; coding-agent/SWE-oriented |
| `cohere/north-mini-code:free@openrouter` | Coding-focused fallback |
| `poolside/laguna-xs-2.1:free@openrouter` | Smaller Laguna fallback |
| `nvidia/nemotron-3-super-120b-a12b:free@openrouter` | General large-model fallback |
| `openai/gpt-oss-20b:free@openrouter` | Compact open-model fallback |

OpenRouter's free tier has rate limits, so CI intentionally uses smoke runs of
5–10 instances. Override `model` in `workflow_dispatch` to select another free
model. Paid Anthropic or OpenAI keys still work when their matching model is
selected with the model override.

### Safety

- **Fork PRs are rejected** — the benchmark cannot access secrets from a fork,
  so the Prepare job fails fast with an actionable error.
- **Hosted-runner hard-cap:** `max_instances` is refused above **50** on GitHub
  hosted runners. Larger runs should use a self-hosted runner or a cloud VM.
- **No Docker harness in CI:** the workflow only produces `predictions.jsonl`.
  The full 500-instance run + Docker-based evaluation is intentionally **not**
  done in GitHub Actions; run it on a cloud VM per the instructions below.
- **Concurrency:** superseded runs of the same ref/PR are cancelled
  (`cancel-in-progress: true`).

### Evaluating CI predictions locally

```bash
# Download the swe-bench-predictions-<run_id> artifact, then:
git clone https://github.com/swe-bench/SWE-bench.git
cd SWE-bench
pip install -e .

python -m swebench.harness.run_evaluation \
  --dataset_name SWE-bench/SWE-bench_Verified \
  --predictions_path ../predictions.jsonl \
  --max_workers 8 \
  --run_id tiny-agent-verified
```

## Notes

- Each instance clones/updates the repository, checks out the `base_commit`, runs `tiny-agent`, and saves the resulting `git diff`
- The script saves predictions incrementally (after each instance) so you can resume after a crash
- The evaluation harness requires Docker and significant disk space for container images
- For macOS ARM users, pass `--namespace ''` to the evaluation harness to build images locally
- Prompt files (`/tmp/swe_prompt_<instance_id>.md`) are cleaned up after each run
