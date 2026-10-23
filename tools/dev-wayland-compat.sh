#!/bin/sh
# Opt-in workaround for the affected Linux NVIDIA/Wayland graphics stack.
# Keep the ordinary dev command available to retest upstream package updates.
set -eu
if [ "$(uname -s)" != Linux ]; then
  echo 'dev:wayland-compat is a Linux-only development helper. Use bun run dev.' >&2
  exit 1
fi
exec env __NV_DISABLE_EXPLICIT_SYNC=1 bun run dev "$@"
