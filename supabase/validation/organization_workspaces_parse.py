"""Parse SQL/PLpgSQL only. No connection, SQL execution, writes or downloads."""
import argparse
import pathlib
import re
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--pglast-path", type=pathlib.Path)
parser.add_argument("--sql-file", type=pathlib.Path, help="Parse another local SQL artifact instead of the migration.")
parser.add_argument("--rollback-only", action="store_true", help="Require exactly BEGIN then ROLLBACK.")
args = parser.parse_args()
if args.pglast_path:
    sys.path.insert(0, str(args.pglast_path))

try:
    from pglast import parse_sql, parse_plpgsql
    from pglast.stream import RawStream
except ImportError:
    parser.error("An existing readable pglast installation is required; no package is downloaded.")

path = args.sql_file or pathlib.Path(__file__).resolve().parents[1] / "migrations/20261028_organization_workspaces.sql"
source = path.read_text(encoding="utf-8")
tree = parse_sql(source)
if args.rollback_only:
    transactions = [RawStream()(statement.stmt) for statement in tree
                    if type(statement.stmt).__name__ == "TransactionStmt"]
    if len(transactions) != 2 or not transactions[0].startswith("BEGIN") or transactions[1] != "ROLLBACK":
        parser.error(f"Expected exactly BEGIN then ROLLBACK, found {transactions}")
blocks = []
sql_bodies = []
for statement in tree:
    node = statement.stmt
    if type(node).__name__ == "DoStmt":
        blocks.append(RawStream()(node))
    elif type(node).__name__ == "CreateFunctionStmt":
        if any(option.defname == "language" and option.arg.sval == "plpgsql" for option in node.options):
            blocks.append(RawStream()(node))
        elif any(option.defname == "language" and option.arg.sval == "sql" for option in node.options):
            sql_bodies.append(next(option.arg[0].sval for option in node.options if option.defname == "as"))
for block in blocks:
    parse_plpgsql(block)
for body in sql_bodies:
    parse_sql(body)
probe_bodies = re.findall(r"\$probe_sql\$([\s\S]*?)\$probe_sql\$", source)
for body in probe_bodies:
    # Validate trusted dynamic SQL templates without evaluating their data.
    for statement in parse_sql(body.replace("%L", "'null'")):
        if type(statement.stmt).__name__ == "TransactionStmt":
            parser.error("Transaction control is forbidden inside authorization probe SQL.")
        if type(statement.stmt).__name__ == "DoStmt":
            parse_plpgsql(RawStream()(statement.stmt))
print(f"PASS: {len(tree)} SQL statements, {len(blocks)} PL/pgSQL definitions and {len(sql_bodies)} SQL function bodies parsed. No SQL executed.")
if probe_bodies:
    print(f"PASS: {len(probe_bodies)} dynamic probe SQL templates and nested DO bodies parsed; no SQL executed.")
