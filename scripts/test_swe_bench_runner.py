#!/usr/bin/env python3
"""
Unit tests for swe_bench_runner.py.

These tests are pure-Python and require no Hugging Face datasets, no tiny-agent
binary, and no network access.  Run with:

    python3 -m unittest scripts/test_swe_bench_runner.py -v

or from inside scripts/:

    python3 -m unittest test_swe_bench_runner -v
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# Ensure the scripts directory is on sys.path so we can import the runner
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

import swe_bench_runner  # noqa: E402


class TestLoadExistingPredictions(unittest.TestCase):
    """Tests for load_existing_predictions."""

    def test_parses_valid_jsonl(self):
        lines = [
            json.dumps({"instance_id": "a__a-1", "model_name_or_path": "m", "model_patch": "diff"}),
            json.dumps({"instance_id": "b__b-2", "model_name_or_path": "m", "model_patch": ""}),
        ]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write("\n".join(lines) + "\n")
            path = f.name
        try:
            result = swe_bench_runner.load_existing_predictions(path)
            self.assertEqual(len(result), 2)
            self.assertIn("a__a-1", result)
            self.assertIn("b__b-2", result)
            self.assertEqual(result["a__a-1"]["model_patch"], "diff")
        finally:
            os.unlink(path)

    def test_skips_bad_lines(self):
        lines = [
            json.dumps({"instance_id": "good__1", "model_name_or_path": "m", "model_patch": ""}),
            "this is not json {{{",
            "",
            json.dumps({"instance_id": "good__2", "model_name_or_path": "m", "model_patch": ""}),
        ]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write("\n".join(lines) + "\n")
            path = f.name
        try:
            result = swe_bench_runner.load_existing_predictions(path)
            self.assertEqual(len(result), 2)
            self.assertIn("good__1", result)
            self.assertIn("good__2", result)
        finally:
            os.unlink(path)

    def test_nonexistent_file_returns_empty(self):
        result = swe_bench_runner.load_existing_predictions("/nonexistent/path/file.jsonl")
        self.assertEqual(result, {})


class TestAppendPrediction(unittest.TestCase):
    """Tests for append_prediction."""

    def test_writes_correct_schema(self):
        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
            path = f.name
        try:
            swe_bench_runner.append_prediction(path, "test__inst-1", "tiny-agent", "some diff")
            swe_bench_runner.append_prediction(path, "test__inst-2", "tiny-agent", None)

            with open(path) as fh:
                lines = [json.loads(l) for l in fh if l.strip()]

            self.assertEqual(len(lines), 2)
            self.assertEqual(lines[0]["instance_id"], "test__inst-1")
            self.assertEqual(lines[0]["model_name_or_path"], "tiny-agent")
            self.assertEqual(lines[0]["model_patch"], "some diff")
            self.assertEqual(lines[1]["instance_id"], "test__inst-2")
            self.assertEqual(lines[1]["model_patch"], "")
        finally:
            os.unlink(path)

    def test_appends_multiple_predictions_without_corruption(self):
        """Sequential appends produce one valid JSON object per line."""
        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
            path = f.name
        try:
            for i in range(5):
                swe_bench_runner.append_prediction(
                    path, f"test__inst-{i}", "tiny-agent", f"diff-{i}"
                )
            with open(path) as fh:
                lines = [json.loads(l) for l in fh if l.strip()]
            self.assertEqual(len(lines), 5)
            for i, row in enumerate(lines):
                self.assertEqual(row["instance_id"], f"test__inst-{i}")
                self.assertEqual(row["model_patch"], f"diff-{i}")
        finally:
            os.unlink(path)


class TestCloneOrUpdateRepo(unittest.TestCase):
    """Tests for clone_or_update_repo — verifies per-instance isolation."""

    def test_clone_path_includes_instance_id(self):
        """The clone path must be workspace/<instance_id>/repo."""
        repo = "django/django"
        instance_id = "django__django-12345"

        with tempfile.TemporaryDirectory() as temp_dir:
            workspace = Path(temp_dir)
            with mock.patch.object(swe_bench_runner.subprocess, "run") as mock_run:
                mock_run.return_value = mock.Mock(returncode=0)
                repo_dir = swe_bench_runner.clone_or_update_repo(workspace, repo, instance_id)

                self.assertEqual(repo_dir, workspace / instance_id / "repo")

                clone_call = mock_run.call_args_list[0]
                self.assertEqual(clone_call.args[0][0:2], ["git", "clone"])
                self.assertEqual(clone_call.args[0][-1], str(repo_dir))

    def test_existing_repo_fetches(self):
        workspace = Path(tempfile.mkdtemp())
        instance_id = "test__inst-1"
        repo = "test/repo"
        instance_dir = workspace / instance_id
        repo_dir = instance_dir / "repo"
        repo_dir.mkdir(parents=True)

        try:
            with mock.patch.object(swe_bench_runner.subprocess, "run") as mock_run:
                mock_run.return_value = mock.Mock(returncode=0)
                result = swe_bench_runner.clone_or_update_repo(workspace, repo, instance_id)

                self.assertEqual(result, repo_dir)
                # First (and only) call should be a fetch, not clone
                fetch_call = mock_run.call_args_list[0]
                self.assertEqual(fetch_call.args[0][:2], ["git", "-C"])
                self.assertIn("fetch", fetch_call.args[0])
        finally:
            import shutil
            shutil.rmtree(workspace, ignore_errors=True)


class TestRunTinyAgent(unittest.TestCase):
    """Tests for run_tiny_agent — verifies cmd construction and patch capture."""

    def test_builds_correct_cmd_and_reads_cached_diff(self):
        repo_dir = Path("/tmp/swe-test-repo")
        instance_id = "test__inst-1"

        def fake_run(cmd, **kwargs):
            if cmd[0] == "tiny-agent":
                return mock.Mock(returncode=0, stdout="done", stderr="")
            elif cmd[:3] == ["git", "-C", str(repo_dir)] and "add" in cmd:
                return mock.Mock(returncode=0, stdout="", stderr="")
            elif cmd[:3] == ["git", "-C", str(repo_dir)] and "diff" in cmd:
                return mock.Mock(returncode=0, stdout="diff --git a/foo b/foo\n+hello", stderr="")
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch.object(
            swe_bench_runner.subprocess, "run", side_effect=fake_run
        ) as mock_run:
            with mock.patch.object(swe_bench_runner.os, "unlink"):
                patch = swe_bench_runner.run_tiny_agent(
                    repo_dir, "fix the bug", instance_id, model="test-model", timeout_minutes=1,
                )

        self.assertIsNotNone(patch)
        self.assertIn("diff --git", patch)

        # tiny-agent command must include the model flag when provided.
        tiny_agent_calls = [
            call.args[0] for call in mock_run.call_args_list
            if call.args[0] and call.args[0][0] == "tiny-agent"
        ]
        self.assertTrue(tiny_agent_calls, "tiny-agent was never invoked")
        self.assertIn("--model", tiny_agent_calls[0])
        self.assertIn("test-model", tiny_agent_calls[0])

    def test_returns_none_when_git_add_fails(self):
        repo_dir = Path("/tmp/swe-test-repo")
        instance_id = "test__inst-add-fail"

        def fake_run(cmd, **kwargs):
            if cmd[0] == "tiny-agent":
                return mock.Mock(returncode=0, stdout="done", stderr="")
            if "add" in cmd:
                return mock.Mock(returncode=1, stdout="", stderr="index.lock")
            return mock.Mock(returncode=0, stdout="diff", stderr="")

        with mock.patch.object(swe_bench_runner.subprocess, "run", side_effect=fake_run):
            with mock.patch.object(swe_bench_runner.os, "unlink"):
                patch = swe_bench_runner.run_tiny_agent(
                    repo_dir, "fix the bug", instance_id, model="", timeout_minutes=1,
                )
        self.assertIsNone(patch)

    def test_returns_none_when_git_diff_fails(self):
        repo_dir = Path("/tmp/swe-test-repo")
        instance_id = "test__inst-diff-fail"

        def fake_run(cmd, **kwargs):
            if cmd[0] == "tiny-agent":
                return mock.Mock(returncode=0, stdout="done", stderr="")
            if "diff" in cmd:
                return mock.Mock(returncode=128, stdout="", stderr="not a git repo")
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch.object(swe_bench_runner.subprocess, "run", side_effect=fake_run):
            with mock.patch.object(swe_bench_runner.os, "unlink"):
                patch = swe_bench_runner.run_tiny_agent(
                    repo_dir, "fix the bug", instance_id, model="", timeout_minutes=1,
                )
        self.assertIsNone(patch)

    def test_returns_empty_string_when_no_changes(self):
        repo_dir = Path("/tmp/swe-test-repo")
        instance_id = "test__inst-2"

        def fake_run(cmd, **kwargs):
            if cmd[0] == "tiny-agent":
                return mock.Mock(returncode=0, stdout="done", stderr="")
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch.object(swe_bench_runner.subprocess, "run", side_effect=fake_run):
            with mock.patch.object(swe_bench_runner.os, "unlink"):
                patch = swe_bench_runner.run_tiny_agent(
                    repo_dir, "fix the bug", instance_id, model="", timeout_minutes=1,
                )

        self.assertEqual(patch, "")

    def test_returns_none_on_timeout(self):
        repo_dir = Path("/tmp/swe-test-repo")
        instance_id = "test__inst-3"

        def fake_run(cmd, **kwargs):
            if cmd[0] == "tiny-agent":
                raise subprocess.TimeoutExpired(cmd, 60)
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch.object(swe_bench_runner.subprocess, "run", side_effect=fake_run):
            with mock.patch.object(swe_bench_runner.os, "unlink"):
                patch = swe_bench_runner.run_tiny_agent(
                    repo_dir, "fix the bug", instance_id, model="", timeout_minutes=1,
                )

        self.assertIsNone(patch)

    def test_cleans_up_prompt_file(self):
        repo_dir = Path("/tmp/swe-test-repo")
        instance_id = "test__inst-cleanup"
        prompt_path = f"/tmp/swe_prompt_{instance_id}.md"

        def fake_run(cmd, **kwargs):
            if cmd[0] == "tiny-agent":
                # Prompt should exist while agent runs
                self.assertTrue(os.path.exists(prompt_path))
                return mock.Mock(returncode=0, stdout="done", stderr="")
            return mock.Mock(returncode=0, stdout="", stderr="")

        # Clean any leftover
        try:
            os.unlink(prompt_path)
        except OSError:
            pass

        with mock.patch.object(swe_bench_runner.subprocess, "run", side_effect=fake_run):
            swe_bench_runner.run_tiny_agent(
                repo_dir, "fix the bug", instance_id, model="", timeout_minutes=1,
            )

        self.assertFalse(os.path.exists(prompt_path))

    def test_cleans_up_prompt_file_on_timeout(self):
        """Prompt file must be removed even when tiny-agent times out."""
        repo_dir = Path("/tmp/swe-test-repo")
        instance_id = "test__inst-cleanup-timeout"
        prompt_path = f"/tmp/swe_prompt_{instance_id}.md"

        def fake_run(cmd, **kwargs):
            if cmd[0] == "tiny-agent":
                self.assertTrue(os.path.exists(prompt_path))
                raise subprocess.TimeoutExpired(cmd, 60)
            return mock.Mock(returncode=0, stdout="", stderr="")

        try:
            os.unlink(prompt_path)
        except OSError:
            pass

        with mock.patch.object(swe_bench_runner.subprocess, "run", side_effect=fake_run):
            swe_bench_runner.run_tiny_agent(
                repo_dir, "fix the bug", instance_id, model="", timeout_minutes=1,
            )

        self.assertFalse(os.path.exists(prompt_path))


class TestProcessInstance(unittest.TestCase):
    """Tests for process_instance error handling."""

    def test_called_process_error_appends_empty_prediction(self):
        instance = {
            "instance_id": "test__err-1",
            "repo": "test/repo",
            "base_commit": "abc123",
            "problem_statement": "fix something",
        }
        workspace = Path("/tmp/swe-test-workspace")

        with mock.patch.object(swe_bench_runner, "clone_or_update_repo",
                               side_effect=subprocess.CalledProcessError(1, "git")):
            with mock.patch.object(swe_bench_runner, "append_prediction") as mock_append:
                instance_id, patch = swe_bench_runner.process_instance(
                    instance, workspace, "", "/tmp/out.jsonl", "tiny-agent", 30, 1, 1,
                )

                self.assertEqual(instance_id, "test__err-1")
                self.assertIsNone(patch)
                # append_prediction should be called with None patch
                mock_append.assert_called_once()
                call_args = mock_append.call_args
                # args: (output_path, instance_id, model_name, patch)
                self.assertIsNone(call_args.args[3])

    def test_generic_exception_appends_empty_prediction(self):
        instance = {
            "instance_id": "test__err-2",
            "repo": "test/repo",
            "base_commit": "abc123",
            "problem_statement": "fix something",
        }
        workspace = Path("/tmp/swe-test-workspace")

        with mock.patch.object(swe_bench_runner, "clone_or_update_repo",
                               side_effect=RuntimeError("boom")):
            with mock.patch.object(swe_bench_runner, "append_prediction") as mock_append:
                instance_id, patch = swe_bench_runner.process_instance(
                    instance, workspace, "", "/tmp/out.jsonl", "tiny-agent", 30, 1, 1,
                )

                self.assertIsNone(patch)
                mock_append.assert_called_once()
                self.assertIsNone(mock_append.call_args.args[3])


class TestParseArgs(unittest.TestCase):
    """Tests for argument parsing and validation."""

    def test_rejects_parallel_zero(self):
        with self.assertRaises(SystemExit):
            swe_bench_runner.parse_args(["--parallel", "0"])

    def test_rejects_parallel_negative(self):
        with self.assertRaises(SystemExit):
            swe_bench_runner.parse_args(["--parallel", "-1"])

    def test_accepts_parallel_one(self):
        args = swe_bench_runner.parse_args(["--parallel", "1"])
        self.assertEqual(args.parallel, 1)

    def test_accepts_parallel_positive(self):
        args = swe_bench_runner.parse_args(["--parallel", "4"])
        self.assertEqual(args.parallel, 4)

    def test_default_parallel_is_one(self):
        args = swe_bench_runner.parse_args([])
        self.assertEqual(args.parallel, 1)

    def test_evaluate_flag(self):
        args = swe_bench_runner.parse_args(["--evaluate"])
        self.assertTrue(args.evaluate)


class TestMainDryRun(unittest.TestCase):
    """Tests for main() in dry-run mode."""

    @mock.patch("swe_bench_runner.check_tiny_agent")
    @mock.patch("swe_bench_runner.load_instances")
    def test_dry_run_does_not_call_tiny_agent_check(self, mock_load, mock_check):
        mock_load.return_value = [
            {
                "instance_id": "test__dry-1",
                "repo": "test/repo",
                "base_commit": "abc123",
                "problem_statement": "fix something",
            }
        ]
        swe_bench_runner.main(["--dry-run", "--max-instances", "1"])

        # check_tiny_agent must not be called in dry-run mode
        mock_check.assert_not_called()

    @mock.patch("swe_bench_runner.check_tiny_agent")
    @mock.patch("swe_bench_runner.load_instances")
    def test_dry_run_prints_instances(self, mock_load, mock_check):
        mock_load.return_value = [
            {
                "instance_id": "test__dry-1",
                "repo": "test/repo",
                "base_commit": "abc123",
                "problem_statement": "fix something",
            }
        ]
        swe_bench_runner.main(["--dry-run", "--max-instances", "1"])
        mock_check.assert_not_called()


class TestPrintEvaluateCommand(unittest.TestCase):
    """Tests for print_evaluate_command."""

    def test_prints_harness_command(self):
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            swe_bench_runner.print_evaluate_command("SWE-bench/SWE-bench_Verified", "/tmp/predictions.jsonl")

        output = buf.getvalue()
        self.assertIn("swebench.harness.run_evaluation", output)
        self.assertIn("SWE-bench/SWE-bench_Verified", output)
        self.assertIn("/tmp/predictions.jsonl", output)


if __name__ == "__main__":
    unittest.main()
