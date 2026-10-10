#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "9.9.9 (Claude Code)"
  exit 0
fi
case "$FAKE_MODE" in
  ok)
    if [ -n "$FAKE_DUMP" ]; then
      cat > "$FAKE_DUMP/stdin"
      printf '%s\n' "$@" > "$FAKE_DUMP/args"
      printf '%s' "$PATH" > "$FAKE_DUMP/path"
    else
      cat > /dev/null
    fi
    printf '%s' '{"type":"result","subtype":"success","is_error":false,"result":"{}","structured_output":{"ok":true}}'
    ;;
  exit)
    cat > /dev/null
    echo "Invalid API key · Please run /login" >&2
    exit 1
    ;;
  garbage)
    cat > /dev/null
    echo "this is not json"
    ;;
  is_error)
    cat > /dev/null
    printf '%s' '{"type":"result","subtype":"error_max_turns","is_error":true,"result":"ran out of turns"}'
    ;;
  no_structured)
    cat > /dev/null
    printf '%s' '{"type":"result","subtype":"success","is_error":false,"result":"hi"}'
    ;;
  sleep)
    exec sleep 30
    ;;
esac
