#!/usr/bin/env python3
"""CloudWatch Logs IAM change (enforced from 26 April 2027): scan, and on an owner-armed run fix, the policies of
the bootstrap host's role.

From that date a log-group-level action (DescribeLogStreams, FilterLogEvents, ...) is authorized only against the
standard log group ARN (arn:aws:logs:<region>:<account>:log-group:<name>), no longer against the old form with a
trailing ':*'. Runs on the bootstrap host through SSM, as the host role (scripts/aws/cwl-iam-scan.sh).

  plan      read-only. For each policy of the host role (inline, and customer-managed attached), simulates it with
            AWS's validator (scripts/aws/cwl-iam/simulate_cloudwatch_logs_policy.py) and lists the actions that
            the old ARN form allows today but the standard form would not. Also lists every customer-managed or
            inline policy in the account that still uses the old form (AWS's LIST_IMPACTED_POLICIES check).
  fix-once  for each host-role policy with such actions, adds the standard log group ARN next to every old
            ':*' ARN in its Allow statements (nothing is removed), checks the result with the validator before
            and after writing it, and writes it back: put-role-policy (inline) or a new default version
            (customer-managed; refuses if the policy already has 5 versions).

Prints policy names, log group names and action names only: never credentials or whole policy documents.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

REGION = "ap-south-1"
ACCOUNT = "310356785722"
HERE = os.path.dirname(os.path.abspath(__file__))
VALIDATOR = os.path.join(HERE, "cwl-iam", "simulate_cloudwatch_logs_policy.py")
# Actions that are authorized against the log stream ARN, so the old form is still right for them.
STREAM_ACTIONS = {"logs:CreateLogStream", "logs:PutLogEvents", "logs:GetLogEvents", "logs:DeleteLogStream"}
# AWS's check: a log-group ARN ending in ':*' or naming a log stream.
OLD_ARN = re.compile(r"^arn:aws[a-z0-9-]*:logs:[^:]*:[^:]*:log-group:.*(:\*$|:log-stream:)")
OLD_GROUP_ARN = re.compile(r"^(arn:aws[a-z0-9-]*:logs:[^:]*:[^:]*:log-group:[^:]+):\*$")
GROUP_IN_ARN = re.compile(r"^arn:aws[a-z0-9-]*:logs:[^:]*:[^:]*:log-group:([^:]+)")


def out(*parts):
    print(" ".join(str(p) for p in parts), flush=True)


def as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def grants_logs(statement):
    return any(a == "*" or str(a).lower().startswith("logs:") for a in as_list(statement.get("Action")))


# ---------------------------------------------------------------- pure functions (covered by --self-test)

def old_arns(document):
    """(effect, field, arn) for every old-form log group ARN in a policy document."""
    found = []
    for statement in as_list(document.get("Statement")):
        for field in ("Resource", "NotResource"):
            for arn in as_list(statement.get(field)):
                if isinstance(arn, str) and OLD_ARN.match(arn):
                    found.append((statement.get("Effect", "Unknown"), field, arn))
    return found


def simulated_groups(document):
    """Log group names to simulate: every log group named in a statement that grants logs actions. A wildcard in a
    name becomes 'sample' (the validator needs a concrete name)."""
    groups = set()
    for statement in as_list(document.get("Statement")):
        if not grants_logs(statement):
            continue
        for arn in as_list(statement.get("Resource")):
            match = GROUP_IN_ARN.match(arn) if isinstance(arn, str) else None
            if match:
                groups.add(match.group(1).replace("*", "sample"))
    return sorted(groups)


def parse_table(text):
    """{action: (log_stream_decision, log_group_decision)} from the validator's table."""
    rows = {}
    seen_rule = False
    for line in text.splitlines():
        if line.startswith("----"):
            seen_rule = True
            continue
        if not seen_rule or not line.strip():
            if seen_rule and not line.strip():
                break
            continue
        cells = line.split()
        if len(cells) == 3 and cells[0].startswith("logs:"):
            rows[cells[0]] = (cells[1].rstrip("*"), cells[2].rstrip("*"))
    return rows


def breaking_actions(rows):
    """Log-group-level actions allowed through the old ARN form today but not through the standard form."""
    return sorted(a for a, (stream, group) in rows.items() if stream == "allowed" and group != "allowed" and a not in STREAM_ACTIONS)


def add_standard_arns(document):
    """A copy of the document where every Allow statement that grants logs actions also lists the standard log group
    ARN next to each old ':*' ARN. Nothing is removed or reordered. Returns (document, added ARNs)."""
    doc = json.loads(json.dumps(document))
    added = []
    statements = doc.get("Statement")
    for statement in (statements if isinstance(statements, list) else [statements]):
        if statement.get("Effect") != "Allow" or not grants_logs(statement) or "Resource" not in statement:
            continue
        resources = as_list(statement["Resource"])
        result = list(resources)
        for arn in resources:
            match = OLD_GROUP_ARN.match(arn) if isinstance(arn, str) else None
            if match and match.group(1) not in result:
                result.insert(result.index(arn), match.group(1))
                added.append(match.group(1))
        if added and result != resources:
            statement["Resource"] = result
    return doc, added


def self_test():
    doc = {"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Action": ["logs:DescribeLogStreams", "logs:GetLogEvents"],
         "Resource": "arn:aws:logs:ap-south-1:1:log-group:/ecs/app/web:*"},
        {"Effect": "Allow", "Action": "logs:FilterLogEvents",
         "Resource": ["arn:aws:logs:ap-south-1:1:log-group:/ecs/app/api", "arn:aws:logs:ap-south-1:1:log-group:/ecs/app/api:*"]},
        {"Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::b/*"},
        {"Effect": "Deny", "Action": "logs:DeleteLogGroup", "Resource": "arn:aws:logs:ap-south-1:1:log-group:/x:*"},
    ]}
    assert [a for _, _, a in old_arns(doc)] == ["arn:aws:logs:ap-south-1:1:log-group:/ecs/app/web:*",
                                                "arn:aws:logs:ap-south-1:1:log-group:/ecs/app/api:*",
                                                "arn:aws:logs:ap-south-1:1:log-group:/x:*"]
    assert simulated_groups(doc) == ["/ecs/app/api", "/ecs/app/web", "/x"]
    assert simulated_groups({"Statement": {"Effect": "Allow", "Action": "logs:*", "Resource": "arn:aws:logs:r:1:log-group:/aws/lambda/*:*"}}) == ["/aws/lambda/sample"]
    fixed, added = add_standard_arns(doc)
    assert added == ["arn:aws:logs:ap-south-1:1:log-group:/ecs/app/web"], added
    assert fixed["Statement"][0]["Resource"] == ["arn:aws:logs:ap-south-1:1:log-group:/ecs/app/web", "arn:aws:logs:ap-south-1:1:log-group:/ecs/app/web:*"]
    assert fixed["Statement"][1] == doc["Statement"][1], "an already-standard ARN is left alone"
    assert fixed["Statement"][3] == doc["Statement"][3], "Deny statements are never touched"
    assert doc["Statement"][0]["Resource"] == "arn:aws:logs:ap-south-1:1:log-group:/ecs/app/web:*", "the input is not modified"
    table = "\n".join([
        "LogStream ARN: x", "LogGroup  ARN: y", "Actions simulated: 3", "",
        "Action                 LogStream     LogGroup",
        "---------------------  ------------  ------------",
        "logs:DescribeLogStreams  allowed       implicitDeny",
        "logs:GetLogEvents      allowed       implicitDeny",
        "logs:FilterLogEvents   allowed*      allowed",
        "", "* MissingContextValues (decision depends on unset condition keys):", "  logs:X [LogGroup]: k",
    ])
    rows = parse_table(table)
    assert rows == {"logs:DescribeLogStreams": ("allowed", "implicitDeny"), "logs:GetLogEvents": ("allowed", "implicitDeny"),
                    "logs:FilterLogEvents": ("allowed", "allowed")}, rows
    assert breaking_actions(rows) == ["logs:DescribeLogStreams"]
    print("CWL_IAM_SELF_TEST=ok")


# ---------------------------------------------------------------- AWS (read-only unless ACTION is fix-once)

def aws(*args):
    result = subprocess.run(["aws", *args, "--region", REGION, "--output", "json"], capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        detail = (result.stderr.strip().splitlines() or ["no detail"])[-1][:300]
        raise RuntimeError("aws %s %s failed: %s" % (args[0], args[1], detail))
    return json.loads(result.stdout) if result.stdout.strip() else {}


def simulate(document, group):
    with tempfile.TemporaryDirectory(prefix="cwl-iam-") as work:
        path = os.path.join(work, "policy.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle)
        result = subprocess.run([sys.executable, "-I", VALIDATOR, path, group, "--region", REGION, "--account-id", ACCOUNT],
                                capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        raise RuntimeError("validator failed for %s: %s" % (group, (result.stderr.strip().splitlines() or ["no detail"])[-1][:300]))
    return parse_table(result.stdout)


def breaks_of(document):
    """{log group: [breaking actions]} for one policy document."""
    found = {}
    for group in simulated_groups(document):
        actions = breaking_actions(simulate(document, group))
        if actions:
            found[group] = actions
    return found


def host_role():
    arn = aws("sts", "get-caller-identity")["Arn"]
    match = re.match(r"^arn:aws:sts::(\d{12}):assumed-role/([^/]+)/", arn)
    if not match or match.group(1) != ACCOUNT:
        raise RuntimeError("not running as a role in the staging account")
    return match.group(2)


def host_policies(role):
    policies = []
    for name in aws("iam", "list-role-policies", "--role-name", role).get("PolicyNames", []):
        document = aws("iam", "get-role-policy", "--role-name", role, "--policy-name", name)["PolicyDocument"]
        policies.append({"kind": "inline", "name": name, "document": document})
    for attached in aws("iam", "list-attached-role-policies", "--role-name", role).get("AttachedPolicies", []):
        arn = attached["PolicyArn"]
        if arn.startswith("arn:aws:iam::aws:policy/"):
            out("CWL_IAM_POLICY kind=aws-managed name=%s (updated by AWS)" % attached["PolicyName"])
            continue
        version = aws("iam", "get-policy", "--policy-arn", arn)["Policy"]["DefaultVersionId"]
        document = aws("iam", "get-policy-version", "--policy-arn", arn, "--version-id", version)["PolicyVersion"]["Document"]
        policies.append({"kind": "managed", "name": attached["PolicyName"], "arn": arn, "document": document})
    return policies


def account_impacted():
    details = aws("iam", "get-account-authorization-details", "--filter", "LocalManagedPolicy", "Role", "User", "Group")
    hits = []
    for policy in details.get("Policies", []):
        for version in policy.get("PolicyVersionList", []):
            if version.get("IsDefaultVersion"):
                hits += [("managed", policy["PolicyName"], arn) for _, _, arn in old_arns(version["Document"])]
    for key, inline in (("UserDetailList", "UserPolicyList"), ("GroupDetailList", "GroupPolicyList"), ("RoleDetailList", "RolePolicyList")):
        for principal in details.get(key, []):
            name = principal.get("RoleName") or principal.get("UserName") or principal.get("GroupName")
            for policy in principal.get(inline, []) or []:
                hits += [("inline", "%s [%s]" % (name, policy["PolicyName"]), arn) for _, _, arn in old_arns(policy["PolicyDocument"])]
    return hits


def write_policy(role, policy, document):
    with tempfile.TemporaryDirectory(prefix="cwl-iam-") as work:
        path = os.path.join(work, "policy.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(document, handle)
        if policy["kind"] == "inline":
            aws("iam", "put-role-policy", "--role-name", role, "--policy-name", policy["name"], "--policy-document", "file://" + path)
        else:
            versions = aws("iam", "list-policy-versions", "--policy-arn", policy["arn"]).get("Versions", [])
            if len(versions) >= 5:
                raise RuntimeError("%s already has 5 versions; delete an old one first (not done automatically)" % policy["name"])
            aws("iam", "create-policy-version", "--policy-arn", policy["arn"], "--policy-document", "file://" + path, "--set-as-default")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return 0
    action = os.environ.get("CWL_IAM_ACTION", "plan")
    if action not in ("plan", "fix-once"):
        raise RuntimeError("unsupported action")
    role = host_role()
    out("CWL_IAM_HOST_ROLE name=%s" % role)
    policies = host_policies(role)
    to_fix = []
    for policy in policies:
        document = policy["document"]
        old = old_arns(document)
        breaks = breaks_of(document)
        out("CWL_IAM_POLICY kind=%s name=%s old_arns=%d groups_simulated=%d breaking_groups=%d" % (
            policy["kind"], policy["name"], len(old), len(simulated_groups(document)), len(breaks)))
        for group, actions in sorted(breaks.items()):
            out("CWL_IAM_BREAKS policy=%s group=%s actions=%s" % (policy["name"], group, ",".join(actions)))
        if breaks:
            to_fix.append(policy)
    hits = account_impacted()
    for kind, where, arn in hits:
        out("CWL_IAM_ACCOUNT_OLD_ARN kind=%s policy=%s arn=%s" % (kind, where, arn))
    out("CWL_IAM_SCAN_FINDINGS host_policies=%d host_policies_breaking=%d account_old_arns=%d" % (len(policies), len(to_fix), len(hits)))
    out("CWL_IAM_SCAN_VERIFIED=true")
    if action == "plan":
        return 0

    for policy in to_fix:
        fixed, added = add_standard_arns(policy["document"])
        if breaks_of(fixed):
            raise RuntimeError("%s: adding the standard ARNs does not cover every action; not writing it" % policy["name"])
        write_policy(role, policy, fixed)
        out("CWL_IAM_FIXED policy=%s added=%s" % (policy["name"], ",".join(added)))
    for policy in host_policies(role):
        if breaks_of(policy["document"]):
            raise RuntimeError("%s still has breaking actions after the fix" % policy["name"])
    out("CWL_IAM_FIX_VERIFIED=true")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as error:
        print("CWL_IAM_FAILED %s" % error, file=sys.stderr)
        sys.exit(1)
