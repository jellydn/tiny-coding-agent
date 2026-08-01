# SWE-bench Runner for tiny-coding-agent

This script runs `tiny-agent` against the [SWE-bench Verified](https://www.swebench.com/) benchmark, collecting patches into a `predictions.jsonl` file for evaluation via the official [SWE-bench harness](https://github.com/swe-bench/SWE-bench).

## Requirements

- Python 3.10+
- `pip install datasets`
- `tiny-agent` installed and authenticated (with a configured provider)
- ~120 GB free disk for Docker images (harness) + repo checkouts
- Linux x86_64 recommended (macOS ARM has experimental support)

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

### 3. Evaluate predictions with the official SWE-bench harness

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

## Output Format

The predictions file follows the [SWE-bench prediction format](https://github.com/swe-bench/SWE-bench/blob/main/README.md#predictions):

```jsonl
{"instance_id": "sympy__sympy-20590", "model_name_or_path": "tiny-agent", "model_patch": "diff --git a/..."}
{"instance_id": "django__django-11099", "model_name_or_path": "tiny-agent", "model_patch": "diff --git a/..."}
```

## Notes

- Each instance clones/updates the repository, checks out the `base_commit`, runs `tiny-agent`, and saves the resulting `git diff`
- The script saves predictions incrementally (after each instance) so you can resume after a crash
- The evaluation harness requires Docker and significant disk space for container images
- For macOS ARM users, pass `--namespace ''` to the evaluation harness to build images locally
