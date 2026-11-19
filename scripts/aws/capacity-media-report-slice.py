"""Owner (19 Nov): the read-only report is one source file, but each SSM command carries only what its section needs.

SSM refuses a command over 97 KB, and the whole script had reached 59,896 of the 60,000 characters the wrapper allows.
Each command now sends a slice of capacity-media-report-remote.py: every top-level statement that is not a function or
class (imports, constants, the window set-up), plus the functions and classes the chosen section reaches, directly or
through other functions, plus main(). Comments and docstrings are dropped (ast.unparse); the code is the same code.

The slice is checked here: if the section uses a module-level name that the slice does not define (and that is not a
builtin), it refuses, so a missing helper fails in CI and on the runner, never half-way through a report on AWS.

Usage: python3 -I capacity-media-report-slice.py <remote.py> <section>  -> the slice on stdout
"""
import ast
import builtins
import sys


def module_names(node):
    """Names a top-level statement binds at module level."""
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return {node.name}
    names = set()
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        for alias in node.names:
            names.add((alias.asname or alias.name).split(".")[0])
        return names
    targets = []
    if isinstance(node, ast.Assign):
        targets = node.targets
    elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
        targets = [node.target]
    for target in targets:
        for sub in ast.walk(target):
            if isinstance(sub, ast.Name):
                names.add(sub.id)
    # Names bound inside a top-level if/try/with (the window set-up) count as module names too.
    if isinstance(node, (ast.If, ast.Try, ast.With, ast.For, ast.While)):
        for child in ast.walk(node):
            if child is node:
                continue
            if isinstance(child, ast.Name) and isinstance(child.ctx, ast.Store):
                names.add(child.id)
    return names


def loaded_names(node):
    return {sub.id for sub in ast.walk(node) if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Load)}


def locally_bound(node):
    """Names a function binds itself (parameters, assignments, loops, comprehensions, imports, nested defs, globals)."""
    bound = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.arg):
            bound.add(sub.arg)
        elif isinstance(sub, ast.Name) and isinstance(sub.ctx, (ast.Store, ast.Del)):
            bound.add(sub.id)
        elif isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and sub is not node:
            bound.add(sub.name)
        elif isinstance(sub, (ast.Import, ast.ImportFrom)):
            for alias in sub.names:
                bound.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(sub, ast.ExceptHandler) and sub.name:
            bound.add(sub.name)
    return bound


def slice_source(source, section):
    tree = ast.parse(source)
    body = [n for n in tree.body if not (isinstance(n, ast.If) and isinstance(n.test, ast.Compare)
                                         and isinstance(n.test.left, ast.Name) and n.test.left.id == "__name__")]
    defs = {n.name: n for n in body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
    root = "section_" + section
    if root not in defs:
        raise SystemExit("unknown report section: %s" % section)
    if "main" not in defs:
        raise SystemExit("the report has no main()")
    setup = [n for n in body if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
    defined = set(dir(builtins)) | {"__name__", "__file__"}
    for node in setup:
        defined |= module_names(node)
    wanted, todo = set(), [root, "main"]
    # The set-up statements may call functions too (for example a helper used to build a constant).
    for node in setup:
        todo.extend(name for name in loaded_names(node) - locally_bound(node) if name in defs)
    while todo:
        name = todo.pop()
        if name in wanted:
            continue
        wanted.add(name)
        node = defs[name]
        for used in loaded_names(node) - locally_bound(node):
            if used in defs:
                todo.append(used)
    defined |= wanted
    missing = set()
    for name in wanted:
        node = defs[name]
        missing |= {used for used in loaded_names(node) - locally_bound(node) if used not in defined}
    for node in setup:
        missing |= {used for used in loaded_names(node) - locally_bound(node) if used not in defined and used not in defs}
    if missing:
        raise SystemExit("report section %s uses names the slice does not define: %s" % (section, ", ".join(sorted(missing))))
    kept = [n for n in body if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) or n.name in wanted]
    for node in kept:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str) and len(node.body) > 1:
                node.body = node.body[1:]
    module = ast.Module(body=kept + [ast.parse('if __name__ == "__main__":\n    main()\n').body[0]], type_ignores=[])
    return ast.unparse(module) + "\n"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: capacity-media-report-slice.py <remote.py> <section>")
    with open(sys.argv[1], encoding="utf-8") as handle:
        sys.stdout.write(slice_source(handle.read(), sys.argv[2]))
