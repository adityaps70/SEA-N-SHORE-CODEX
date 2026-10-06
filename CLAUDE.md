@AGENTS.md

# Armed runs: owner merges every arm PR (permanent rule)

- An arm PR is any pull request that sets a guard file (`scripts/aws/*-action.txt`) to anything other than `plan` or
  `discover`. It must read `<action> <40-hex SHA of the commit it arms>` and change only that guard file
  (`scripts/aws/arm-commit-guard.sh` refuses anything else).
- Claude may OPEN arm PRs but must NEVER merge them. adityaps70 merges every arm PR personally. Claude's GitHub
  connector acts as adityaps70, so the guard's merged-by check cannot tell the difference: this rule is what keeps
  the approval meaningful. If Claude cannot follow it in some situation, it stops and tells the owner.
- Rearms (guard back to `plan`/`discover`) stay plain direct commits to the branch; they need no PR.
