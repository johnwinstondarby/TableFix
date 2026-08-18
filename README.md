# TableFix

TableFix is an Adobe InDesign ExtendScript utility for finding tables whose top row visually functions as a table header and comparing that visual state with the document's semantic table and paragraph-style state.

## Project goal

The production document uses black table-header rows with white text. Some of those rows look like headers but are still InDesign body rows rather than `HEADER_ROW`. Their text may also use `Normal` plus manual formatting rather than a dedicated `Table Heading` paragraph style.

The intended final state is:

- the visual header row remains visually unchanged;
- header text uses paragraph style `Table Heading`;
- the top row is an InDesign `HEADER_ROW`;
- NormalFix no longer sees intentional table-heading formatting as `Normal+`.

## v1.0 scope

TableFix v1.0 is read-only. It scans every table in every story and audits the table's top row.

### Primary visual signature

A high-confidence visual header candidate has:

- the first row of the table;
- black cells across the row;
- white text in every non-empty cell.

A strong partial match of at least 75 percent black cells and 75 percent white-text cells is surfaced as `REVIEW` instead of being silently discarded.

`HEADER_ROW` is supporting evidence, not a prerequisite. This is deliberate because some production tables have visually correct headers without the InDesign header-row attribute.

### Additional evidence

The audit also records whether non-empty cells use the expected visual text signature of Aptos Bold at 11 pt. This evidence is reported but is not required for candidate detection.

### Semantic checks

For each candidate, TableFix records:

- whether the top row is already `HEADER_ROW`;
- the table's current `headerRowCount`;
- how many header-row paragraphs use `Table Heading`;
- how many use `Normal`;
- how many use another paragraph style;
- whether a paragraph style named `Table Heading` exists in the document.

### Finding codes

| Code | Severity | Meaning |
| --- | --- | --- |
| `TF-001` | WARNING | High-confidence visual header candidate is missing `Table Heading`, `HEADER_ROW`, or both. |
| `TF-002` | REVIEW | Top row strongly resembles a visual header but does not meet the exact black-row/white-text signature. |
| blank | PASS | High-confidence candidate already uses `Table Heading` throughout and is already `HEADER_ROW`. |

## v1.0 UI

The palette provides:

- **Rescan**
- **Locate**
- double-click to locate
- **Save CSV**
- **Close**

No document formatting or table structure is changed in v1.0.

## Planned remediation

After the production inventory is validated, the remediation release can add selected and multi-selected actions that:

1. verify the candidate still matches the expected visual header signature;
2. create or validate the `Table Heading` paragraph style;
3. apply `Table Heading` to every paragraph in the selected top row;
4. set the top row to `HEADER_ROW` when needed;
5. verify that the visual appearance is unchanged;
6. rescan and report the final semantic state.

The intended `Table Heading` visual definition is Aptos Bold, 11 pt, white/Paper text. The migration should preserve the existing black cell fill.

## CSV

The CSV includes page, story/frame/table location, visual evidence ratios, `HEADER_ROW` state, paragraph-style counts, preview text, finding, and suggested action.

## Compatibility

The script is written for Adobe InDesign ExtendScript / ECMAScript 3 compatibility.
