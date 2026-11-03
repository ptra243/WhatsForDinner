#!/usr/bin/env bash
# Waits on GitHub for a /ship hand-off (decision 0010), prints the result and exits.
# Run it with the Bash tool's run_in_background, so the session is woken when it exits.
#
#   wait-for.sh ready N          until the open PR on branch issue-N-* has a comment starting
#                                "Ready for review"; prints the PR number
#   wait-for.sh merged N [M ...] until every listed issue is closed or has a merged PR on
#                                branch issue-N-*; prints "merged"
#
# Exits 2 after 12 hours with nothing to show, so a stuck hand-off reaches the owner.
set -u
repo=ptra243/WhatsForDinner
mode=${1:?usage: wait-for.sh ready N | merged N [M ...]}
shift
[ $# -gt 0 ] || { echo "no issue numbers given" >&2; exit 64; }
deadline=$(( $(date +%s) + 12 * 3600 ))

# PRs on branch issue-N-*, as "<number> <open|closed> <merged_at or null>" (REST: GraphQL is not available).
prs_for() {
  gh api "repos/$repo/pulls?state=all&per_page=100" \
    --jq ".[] | select(.head.ref | startswith(\"issue-$1-\")) | \"\(.number) \(.state) \(.merged_at)\"" 2>/dev/null
}

issue_done() {
  prs_for "$1" | grep -qv ' null$' && return 0
  [ "$(gh api "repos/$repo/issues/$1" --jq .state 2>/dev/null)" = closed ]
}

while [ "$(date +%s)" -lt "$deadline" ]; do
  case $mode in
    ready)
      p=$(prs_for "$1" | awk '$2 == "open" { print $1; exit }')
      if [ -n "$p" ] && [ -n "$(gh api "repos/$repo/issues/$p/comments?per_page=100" \
          --jq '.[] | select(.body | startswith("Ready for review")) | .id' 2>/dev/null)" ]; then
        echo "$p"
        exit 0
      fi
      ;;
    merged)
      all=1
      for n in "$@"; do issue_done "$n" || { all=0; break; }; done
      [ "$all" = 1 ] && { echo merged; exit 0; }
      ;;
    *)
      echo "unknown mode: $mode" >&2
      exit 64
      ;;
  esac
  sleep 60
done
echo "timed out after 12 hours waiting for $mode $*"
exit 2
