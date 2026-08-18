# TableFix

TableFix is an Adobe InDesign ExtendScript utility for auditing and selectively normalizing tables whose visual top row functions as a header.

## v1.1 scope

TableFix v1.1 expands the v1.0 audit into guarded selected remediation for standard tables.

### Visual header detection

The scanner evaluates the top row of every table. A HIGH-confidence visual header requires:

- all top-row cells to use black/dark fill; and
- all non-empty top-row text to use white/Paper text.

A 75% or greater partial match is reported as REVIEW rather than automatically remediated. `HEADER_ROW` remains supporting semantic evidence and is not required for visual detection.

### Required paragraph styles

TableFix v1.1 expects these paragraph styles to exist exactly once in the document:

- `Table Heading`
- `Table First Column`
- `Table Other Columns`

The character style `CLI Code Red Table` is detected and reported when present, but it is not required for table remediation.

### Standard-table remediation

For an explicitly selected HIGH-confidence, non-complex table, **Fix Selected Tables**:

1. re-checks eligibility immediately before editing;
2. sets the visual top row to `HEADER_ROW` when needed;
3. applies `Table Heading` to all header-row paragraphs;
4. applies `Table First Column` to body paragraphs in the first column;
5. applies `Table Other Columns` to body paragraphs in remaining columns;
6. applies paragraph styles without clearing character attributes;
7. clears paragraph-only overrides with `OverrideType.PARAGRAPH_ONLY`;
8. preserves applied character-style assignments;
9. verifies that red character positions remain unchanged;
10. snapshots cell fills before remediation and restores any fill that changes as a side effect of the semantic header conversion;
11. verifies `HEADER_ROW`, expected clean paragraph styles, character-style assignments, red text, and cell-fill state;
12. rescans and reports Corrected, Skipped, and Could not verify totals.

Normal Windows Ctrl-click and Shift-click selection are supported. There is no document-wide **Fix All** action.

### Cell fills

TableFix does not intentionally redesign cell fills. Existing black header fills and gray/no-fill body striping are preserved. If setting `HEADER_ROW` changes an effective cell fill, TableFix attempts to restore that cell to its pre-fix fill swatch and tint, then verifies the final fill signature.

### Character formatting

Paragraph remediation uses `applyParagraphStyle(style, false)` followed by paragraph-only override clearing. This preserves character-level formatting and character styles such as `CLI Code Red Table` while normalizing paragraph-level formatting.

TableFix also verifies applied character-style assignments and the positions of red text before and after each selected remediation.

### Complex tables

A table is REVIEW-only in v1.1 when it contains:

- merged or spanned cells (`rowSpan > 1` or `columnSpan > 1`); or
- more than one existing header row.

These tables receive `TF-003` and are never changed automatically. This protects custom layouts and coloring from the first-column/other-columns normalization rule.

## Finding codes

| Code | Severity | Meaning |
| --- | --- | --- |
| `TF-001` | WARNING | HIGH-confidence standard table requires semantic or paragraph-style remediation. |
| `TF-002` | REVIEW | Top row only partially matches the visual header signature. |
| `TF-003` | REVIEW | Complex table contains merged/spanned cells or multiple existing header rows. Automatic remediation is disabled. |
| `TF-004` | ERROR | One or more required TableFix paragraph styles are missing or ambiguous. |
| blank | PASS | HIGH-confidence standard table already has `HEADER_ROW` and all expected paragraph styles with no paragraph-level overrides. |

## Compatibility

The script is written for Adobe InDesign ExtendScript / ECMAScript 3 compatibility.
