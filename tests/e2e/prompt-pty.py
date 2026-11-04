"""Run one prompt in an owned POSIX PTY; communicate via a JSON argument/result."""
import errno
import json
import os
import pty
import select
import signal
import subprocess
import sys
import termios
import time


def run(spec):
    master, slave = pty.openpty()
    child = None
    try:
        before = termios.tcgetattr(slave)
        child = subprocess.Popen(
            spec["command"], stdin=slave, stdout=slave, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        stdout = bytearray()
        stderr = bytearray()
        readers = {master: stdout, child.stderr.fileno(): stderr}
        sent = False
        deadline = time.monotonic() + 10
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Prompt or CLI completion timed out")
            ready, _, _ = select.select(list(readers), [], [], min(remaining, 0.1))
            for fd in ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    chunk = b""
                if chunk:
                    readers[fd].extend(chunk)
                else:
                    del readers[fd]
            if not sent and spec["prompt"].encode() in stdout:
                # Input timing depends on observing the actual question.
                payload = spec["input"].encode()
                while payload:
                    written = os.write(master, payload)
                    payload = payload[written:]
                sent = True
            if child.poll() is not None and not ready:
                break
        if not sent:
            raise RuntimeError("CLI exited without displaying the expected prompt")
        code = child.wait(timeout=1)
        return {
            "stdout": stdout.decode(errors="replace"),
            "stderr": stderr.decode(errors="replace"),
            "exitCode": code if code >= 0 else 128 - code,
            "terminalRestored": termios.tcgetattr(slave) == before,
        }
    finally:
        if child is not None:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=2)
            child.stderr.close()
        os.close(master)
        os.close(slave)


print(json.dumps(run(json.loads(sys.argv[1]))))
