# ChatGPT Canvas validation

Run the automated checks with `node --test tests/canvas-chatgpt.test.cjs` from the repository root. These tests use simulated Canvas responses and temporary files, not a real Canvas account.

## Package 0.1.6 — October 3, 2026

- All 13 tools completed their simulated success paths.
- Single-file and module-file downloads wrote the expected bytes into temporary folders.
- Bulk preview wrote no files; an existing file was preserved when overwrite was not requested.
- Assignment text, URL, and file submission paths were exercised against fixtures.
- Discussion topic replies and replies to existing entries were exercised against fixtures.
- Declining either the initial enable prompt or the individual action prompt caused no Canvas POST request.
- The original sequence is preserved: enable once, then confirm every submission/post.

## Windows runtime validation

Tested the installed GitHub package with the Windows ChatGPT runtime (`codex-cli 0.159.2`) in a new ephemeral thread with approval policy `never`.

- Removed the temporary local Canvas approval override before testing, so the package's `.mcp.json` default was the source of approval.
- The runtime registered all 13 tools.
- Model-initiated calls to both download tools, assignment submission, and discussion posting reached the plugin's input validation. They did not fail with the host approval error. Deliberately invalid inputs ensured these permission checks submitted no work and posted no replies.
- A separate live test loaded the existing encrypted token, listed courses, previewed module-file downloads, and downloaded one Canvas file. The saved file was verified on disk at 56,123 bytes in a Windows temporary validation folder.

Actual assignment submission and discussion posting were not tested against a live course. Their successful transport paths and confirmation gates were tested with fixtures. The Windows runtime tests do not claim that every ChatGPT app version or macOS setup has been tested.
