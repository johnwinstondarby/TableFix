#target "InDesign"
#targetengine "TableFix"

/*
TableFix v1.1

Audits and selectively remediates visually formatted table headers and table-body
paragraph styles while preserving table cell fills and character-level formatting.

Visual header detector:
  - top row of a table
  - black/dark cells across the row
  - white text in non-empty cells

Required paragraph styles:
  - Table Heading
  - Table First Column
  - Table Other Columns

Character formatting is preserved. In particular, CLI Code Red Table may remain
applied to inline text while TableFix changes paragraph styles.

Complex tables containing merged/spanned cells, or more than one existing header
row, are review-only in v1.1.

No document-wide Fix All action is provided.
ExtendScript / ECMAScript 3 compatible.
*/

(function () {
    var VERSION = "1.1";
    var TABLE_HEADING_STYLE = "Table Heading";
    var TABLE_FIRST_COLUMN_STYLE = "Table First Column";
    var TABLE_OTHER_COLUMNS_STYLE = "Table Other Columns";
    var CLI_RED_TABLE_STYLE = "CLI Code Red Table";
    var PARAGRAPH_ONLY_OVERRIDE_VALUE = 1885434479;

    var rows = [];
    var counts = null;
    var ui = {};
    var styles = null;

    if (app.documents.length === 0) {
        alert("TableFix v" + VERSION + "\n\nOpen an InDesign document before running TableFix.");
        return;
    }

    buildUI();
    scan();
    ui.win.show();

    function scan() {
        var doc = app.activeDocument;
        var oldRedraw = null;
        var s, t, story, table, result;

        rows = [];
        counts = {
            tablesScanned: 0,
            highCandidates: 0,
            reviewCandidates: 0,
            complexCandidates: 0,
            fixableCandidates: 0,
            fullyCompliant: 0,
            headerMissing: 0,
            headerPresent: 0,
            tablesNeedingParagraphStyles: 0,
            cliRedRuns: 0
        };

        styles = resolveStyles(doc);
        status("Scanning " + docName(doc) + "...");

        try {
            oldRedraw = app.scriptPreferences.enableRedraw;
            app.scriptPreferences.enableRedraw = false;
        } catch (eRedraw) {}

        try {
            for (s = 0; s < doc.stories.length; s++) {
                story = doc.stories.item(s);
                if (!valid(story)) {
                    continue;
                }

                for (t = 0; t < story.tables.length; t++) {
                    table = story.tables.item(t);
                    if (!valid(table) || table.rows.length === 0) {
                        continue;
                    }

                    counts.tablesScanned++;
                    result = auditTable(story, table, t);
                    if (result !== null) {
                        rows.push(result);
                    }
                }
            }

            sortRows();
            refresh(doc);

            if (rows.length > 0) {
                status("Scan complete. Select one or more HIGH, non-complex candidates to fix, or Locate any row for review.");
            } else {
                status("Scan complete. No visual table-header candidates were detected.");
            }
        } catch (eScan) {
            status("Scan failed: " + eScan.message);
            alert("TableFix scan failed.\n\n" + eScan.message + "\nLine: " + errorLine(eScan));
        } finally {
            if (oldRedraw !== null) {
                try { app.scriptPreferences.enableRedraw = oldRedraw; } catch (eRestore) {}
            }
        }
    }

    function auditTable(story, table, tableIndex) {
        var topRow = table.rows.item(0);
        var visual;
        var header;
        var headerCount;
        var complex;
        var styleAudit;
        var loc;
        var confidence;
        var severity;
        var code;
        var fullyCompliant;
        var fixable;
        var action;
        var finding;
        var cliRuns;

        if (!valid(topRow)) {
            return null;
        }

        visual = visualHeaderEvidence(topRow);
        if (visual.confidence === null) {
            return null;
        }

        confidence = visual.confidence;
        if (confidence === "HIGH") {
            counts.highCandidates++;
        } else {
            counts.reviewCandidates++;
        }

        header = isHeaderRow(topRow);
        headerCount = safeNumber(table, "headerRowCount", 0);
        complex = complexTableInfo(table, headerCount);
        styleAudit = auditExpectedParagraphStyles(table);
        loc = locationOfTable(story, table, tableIndex);
        cliRuns = countCharacterStyleRuns(table, CLI_RED_TABLE_STYLE);
        counts.cliRedRuns += cliRuns;

        if (header) {
            counts.headerPresent++;
        } else {
            counts.headerMissing++;
        }

        if (!styleAudit.allClean) {
            counts.tablesNeedingParagraphStyles++;
        }

        if (complex.isComplex) {
            counts.complexCandidates++;
        }

        fullyCompliant = confidence === "HIGH" &&
                         !complex.isComplex &&
                         header &&
                         styleAudit.allClean;

        fixable = confidence === "HIGH" &&
                  !complex.isComplex &&
                  styles.requiredPresent;

        if (fullyCompliant) {
            counts.fullyCompliant++;
        }
        if (fixable && !fullyCompliant) {
            counts.fixableCandidates++;
        }

        if (confidence === "REVIEW") {
            severity = "REVIEW";
            code = "TF-002";
        } else if (complex.isComplex) {
            severity = "REVIEW";
            code = "TF-003";
        } else if (!styles.requiredPresent) {
            severity = "ERROR";
            code = "TF-004";
        } else if (fullyCompliant) {
            severity = "PASS";
            code = "";
        } else {
            severity = "WARNING";
            code = "TF-001";
        }

        action = suggestedAction(confidence, complex, header, styleAudit, styles.requiredPresent);
        finding = findingText(confidence, complex, header, styleAudit, styles.requiredPresent);

        return {
            severity: severity,
            code: code,
            confidence: confidence,
            page: loc.page,
            pageSort: loc.pageSort,
            storyId: loc.storyId,
            frameId: loc.frameId,
            tableIndex: tableIndex,
            tableId: safeProperty(table, "id", "-"),
            rowCount: table.rows.length,
            columnCount: table.columns.length,
            cellCount: topRow.cells.length,
            blackCells: visual.blackCells,
            nonEmptyCells: visual.nonEmptyCells,
            whiteTextCells: visual.whiteTextCells,
            aptosBold10Cells: visual.aptosBold10Cells,
            blackRatio: visual.blackRatio,
            whiteRatio: visual.whiteRatio,
            formatRatio: visual.formatRatio,
            headerRow: header,
            headerRowCount: headerCount,
            complex: complex.isComplex,
            complexReason: complex.reason,
            mergedCellCount: complex.mergedCellCount,
            headerParagraphs: styleAudit.headerTotal,
            headerClean: styleAudit.headerClean,
            firstColumnParagraphs: styleAudit.firstTotal,
            firstColumnClean: styleAudit.firstClean,
            otherColumnParagraphs: styleAudit.otherTotal,
            otherColumnClean: styleAudit.otherClean,
            paragraphOverrides: styleAudit.overrideCount,
            allParagraphStylesClean: styleAudit.allClean,
            cliRedRuns: cliRuns,
            requiredStylesPresent: styles.requiredPresent,
            fixable: fixable,
            fullyCompliant: fullyCompliant,
            preview: previewRow(topRow),
            location: loc.text,
            finding: finding,
            action: action,
            table: table,
            pageRef: loc.pageRef
        };
    }

    function visualHeaderEvidence(row) {
        var cellCount = row.cells.length;
        var blackCells = 0;
        var nonEmptyCells = 0;
        var whiteTextCells = 0;
        var aptosBold10Cells = 0;
        var i, cell, evidence;
        var blackRatio, whiteRatio, formatRatio;
        var confidence = null;

        if (cellCount === 0) {
            return {confidence: null};
        }

        for (i = 0; i < cellCount; i++) {
            cell = row.cells.item(i);
            if (!valid(cell)) {
                continue;
            }

            if (isBlackColor(safePropertyObject(cell, "fillColor"))) {
                blackCells++;
            }

            evidence = textEvidence(cell);
            if (evidence.nonEmpty) {
                nonEmptyCells++;
                if (evidence.white) {
                    whiteTextCells++;
                }
                if (evidence.aptosBold10) {
                    aptosBold10Cells++;
                }
            }
        }

        blackRatio = cellCount > 0 ? blackCells / cellCount : 0;
        whiteRatio = nonEmptyCells > 0 ? whiteTextCells / nonEmptyCells : 0;
        formatRatio = nonEmptyCells > 0 ? aptosBold10Cells / nonEmptyCells : 0;

        if (blackRatio === 1 && nonEmptyCells > 0 && whiteRatio === 1) {
            confidence = "HIGH";
        } else if (blackRatio >= 0.75 && nonEmptyCells > 0 && whiteRatio >= 0.75) {
            confidence = "REVIEW";
        }

        return {
            confidence: confidence,
            blackCells: blackCells,
            nonEmptyCells: nonEmptyCells,
            whiteTextCells: whiteTextCells,
            aptosBold10Cells: aptosBold10Cells,
            blackRatio: blackRatio,
            whiteRatio: whiteRatio,
            formatRatio: formatRatio
        };
    }

    function textEvidence(cell) {
        var text, ranges;
        var i, range, content;
        var nonEmptyRanges = 0;
        var whiteRanges = 0;
        var formatRanges = 0;
        var nonEmptyCell = cleanText(safeContents(cell)).length > 0;

        if (!nonEmptyCell) {
            return {nonEmpty: false, white: true, aptosBold10: true};
        }

        try {
            text = cell.texts.item(0);
            ranges = text.textStyleRanges;
            for (i = 0; i < ranges.length; i++) {
                range = ranges.item(i);
                if (!valid(range)) {
                    continue;
                }
                content = cleanText(safeContents(range));
                if (content.length === 0) {
                    continue;
                }
                nonEmptyRanges++;
                if (isWhiteColor(safePropertyObject(range, "fillColor"))) {
                    whiteRanges++;
                }
                if (isAptosBold10(range)) {
                    formatRanges++;
                }
            }
        } catch (eRanges) {}

        if (nonEmptyRanges === 0) {
            try {
                range = cell.texts.item(0).insertionPoints.item(0);
                nonEmptyRanges = 1;
                if (isWhiteColor(safePropertyObject(range, "fillColor"))) {
                    whiteRanges = 1;
                }
                if (isAptosBold10(range)) {
                    formatRanges = 1;
                }
            } catch (eFallback) {}
        }

        return {
            nonEmpty: true,
            white: nonEmptyRanges > 0 && whiteRanges === nonEmptyRanges,
            aptosBold10: nonEmptyRanges > 0 && formatRanges === nonEmptyRanges
        };
    }

    function auditExpectedParagraphStyles(table) {
        var result = {
            headerTotal: 0,
            headerClean: 0,
            firstTotal: 0,
            firstClean: 0,
            otherTotal: 0,
            otherClean: 0,
            overrideCount: 0,
            allClean: false
        };
        var r, c, row, cell;
        var expected;
        var evidence;

        for (r = 0; r < table.rows.length; r++) {
            row = table.rows.item(r);
            if (!valid(row)) {
                continue;
            }

            for (c = 0; c < row.cells.length; c++) {
                cell = row.cells.item(c);
                if (!valid(cell)) {
                    continue;
                }

                if (r === 0) {
                    expected = TABLE_HEADING_STYLE;
                    evidence = auditCellParagraphs(cell, expected);
                    result.headerTotal += evidence.total;
                    result.headerClean += evidence.clean;
                } else if (c === 0) {
                    expected = TABLE_FIRST_COLUMN_STYLE;
                    evidence = auditCellParagraphs(cell, expected);
                    result.firstTotal += evidence.total;
                    result.firstClean += evidence.clean;
                } else {
                    expected = TABLE_OTHER_COLUMNS_STYLE;
                    evidence = auditCellParagraphs(cell, expected);
                    result.otherTotal += evidence.total;
                    result.otherClean += evidence.clean;
                }

                result.overrideCount += evidence.overrides;
            }
        }

        result.allClean = result.headerTotal > 0 &&
                          result.headerClean === result.headerTotal &&
                          result.firstClean === result.firstTotal &&
                          result.otherClean === result.otherTotal;

        return result;
    }

    function auditCellParagraphs(cell, expectedStyleName) {
        var result = {total: 0, clean: 0, overrides: 0};
        var paras, i, para, override;

        try {
            paras = cell.paragraphs;
            for (i = 0; i < paras.length; i++) {
                para = paras.item(i);
                if (!valid(para)) {
                    continue;
                }
                result.total++;
                override = paragraphOverrideState(para);
                if (override === true) {
                    result.overrides++;
                }
                if (paragraphStyleName(para) === expectedStyleName && override === false) {
                    result.clean++;
                }
            }
        } catch (eParas) {}

        return result;
    }

    function paragraphOverrideState(para) {
        var value;
        try {
            value = para.textHasOverrides(StyleType.PARAGRAPH_STYLE_TYPE, false);
            return value === true;
        } catch (ePrimary) {}
        try {
            value = para.styleOverridden;
            return value === true;
        } catch (eFallback) {}
        return null;
    }

    function complexTableInfo(table, headerCount) {
        var merged = 0;
        var reason = [];
        var i, cell;

        try {
            for (i = 0; i < table.cells.length; i++) {
                cell = table.cells.item(i);
                if (!valid(cell)) {
                    continue;
                }
                if (safeNumber(cell, "rowSpan", 1) > 1 || safeNumber(cell, "columnSpan", 1) > 1) {
                    merged++;
                }
            }
        } catch (eCells) {}

        if (merged > 0) {
            reason.push("Merged/spanned cells: " + merged);
        }
        if (headerCount > 1) {
            reason.push("Multiple existing header rows: " + headerCount);
        }

        return {
            isComplex: reason.length > 0,
            reason: reason.length > 0 ? reason.join("; ") : "None",
            mergedCellCount: merged
        };
    }

    function suggestedAction(confidence, complex, header, styleAudit, requiredPresent) {
        var parts = [];
        if (confidence !== "HIGH") {
            return "Review visual header candidate";
        }
        if (complex.isComplex) {
            return "Review complex table; automatic remediation disabled";
        }
        if (!requiredPresent) {
            return "Create/resolve required TableFix paragraph styles";
        }
        if (!header) {
            parts.push("Set HEADER_ROW");
        }
        if (!styleAudit.allClean) {
            parts.push("Apply table paragraph styles; clear paragraph-only overrides");
        }
        if (parts.length === 0) {
            return "None";
        }
        return parts.join("; ");
    }

    function findingText(confidence, complex, header, styleAudit, requiredPresent) {
        var parts = [];
        if (confidence === "HIGH") {
            parts.push("Top row matches the black-cell / white-text visual header signature.");
        } else {
            parts.push("Top row partially matches the visual header signature and requires review.");
        }
        if (complex.isComplex) {
            parts.push("Complex table: " + complex.reason + ".");
        }
        parts.push(header ? "HEADER_ROW is present." : "HEADER_ROW is missing.");
        parts.push(styleAudit.allClean ? "Table paragraph styles are clean." : "Table paragraph styles require normalization.");
        if (!requiredPresent) {
            parts.push("One or more required paragraph styles are missing or ambiguous.");
        }
        return parts.join(" ");
    }

    function buildUI() {
        var buttons, button;

        ui.win = new Window("palette", "TableFix v" + VERSION);
        ui.win.orientation = "column";
        ui.win.alignChildren = ["fill", "top"];
        ui.win.margins = 12;
        ui.win.spacing = 8;

        ui.title = ui.win.add("statictext", undefined, "Table Audit and Selected Fix");
        try {
            ui.title.graphics.font = ScriptUI.newFont(ui.title.graphics.font.name, "BOLD", 15);
        } catch (eFont) {}

        ui.summary = ui.win.add("statictext", undefined, "", {multiline: true});
        ui.summary.preferredSize = [1120, 100];

        ui.list = ui.win.add("listbox", undefined, [], {multiselect: true});
        ui.list.preferredSize = [1120, 440];
        ui.list.onDoubleClick = locate;

        ui.status = ui.win.add("statictext", undefined, "");
        ui.status.preferredSize = [1120, 34];

        buttons = ui.win.add("group");
        buttons.alignment = ["right", "top"];

        button = buttons.add("button", undefined, "Rescan");
        button.onClick = scan;

        button = buttons.add("button", undefined, "Locate");
        button.onClick = locate;

        button = buttons.add("button", undefined, "Fix Selected Tables");
        button.onClick = fixSelectedTables;

        button = buttons.add("button", undefined, "Save CSV");
        button.onClick = saveCSV;

        button = buttons.add("button", undefined, "Close");
        button.onClick = function () { ui.win.close(); };
    }

    function refresh(doc) {
        var i, row, line;
        ui.list.removeAll();

        for (i = 0; i < rows.length; i++) {
            row = rows[i];
            line = fixed(row.severity, 8) + "  " +
                   fixed(row.confidence, 7) + "  " +
                   fixed(row.page, 8) + "  " +
                   "T" + fixed(row.tableIndex, 4) + "  " +
                   fixed(row.headerRow ? "HEADER" : "BODY", 7) + "  " +
                   fixed(row.complex ? "COMPLEX" : "STANDARD", 8) + "  " +
                   "H " + fixed(row.headerClean + "/" + row.headerParagraphs, 7) + "  " +
                   "C1 " + fixed(row.firstColumnClean + "/" + row.firstColumnParagraphs, 7) + "  " +
                   "C+ " + fixed(row.otherColumnClean + "/" + row.otherColumnParagraphs, 7) + "  " +
                   row.preview;
            ui.list.add("item", line);
        }

        ui.summary.text = docName(doc) + "\n" +
            "Tables scanned: " + counts.tablesScanned +
            "    HIGH candidates: " + counts.highCandidates +
            "    REVIEW candidates: " + counts.reviewCandidates +
            "    Complex: " + counts.complexCandidates +
            "    Fixable: " + counts.fixableCandidates + "\n" +
            "HEADER_ROW present: " + counts.headerPresent +
            "    missing: " + counts.headerMissing +
            "    Fully compliant: " + counts.fullyCompliant +
            "    Need paragraph styles: " + counts.tablesNeedingParagraphStyles + "\n" +
            "Styles: Heading=" + yesNo(styles.heading !== null) +
            "  First Column=" + yesNo(styles.first !== null) +
            "  Other Columns=" + yesNo(styles.other !== null) +
            "  CLI Code Red Table=" + yesNo(styles.cliRed !== null) +
            "    CLI red runs found: " + counts.cliRedRuns;

        try { ui.win.layout.layout(true); } catch (eLayout) {}
    }

    function selectedRows() {
        var selection = ui.list.selection;
        var selected = [];
        var i, item;

        if (selection === null) {
            return selected;
        }

        try {
            if (selection.length !== undefined && selection.index === undefined) {
                for (i = 0; i < selection.length; i++) {
                    item = selection[i];
                    if (item !== null && item !== undefined && item.index !== undefined && rows[item.index] !== undefined) {
                        selected.push(rows[item.index]);
                    }
                }
            } else if (selection.index !== undefined && rows[selection.index] !== undefined) {
                selected.push(rows[selection.index]);
            }
        } catch (eSelection) {}

        return selected;
    }

    function locate() {
        var selected = selectedRows();
        var row, target, located = false;

        if (selected.length === 0) {
            alert("Select a TableFix candidate first.");
            return;
        }

        row = selected[0];
        if (!row || row.table === null || !valid(row.table)) {
            alert("The first selected candidate no longer has a valid table to locate.");
            return;
        }

        try {
            if (row.pageRef !== null && valid(row.pageRef)) {
                app.activeWindow.activePage = row.pageRef;
            }
        } catch (ePage) {}

        try {
            target = row.table.rows.item(0).cells.item(0).texts.item(0);
            target.showText();
            located = true;
        } catch (eShow) {}

        try {
            app.select(target);
            located = true;
        } catch (eSelect) {
            try {
                app.select(row.table.rows.item(0).cells.item(0).texts.item(0).insertionPoints.item(0));
                located = true;
            } catch (eIP) {}
        }

        if (located) {
            status("Located " + row.location + (selected.length > 1 ? ". " + selected.length + " candidates are selected." : "."));
        } else {
            alert("InDesign could not navigate to this candidate.\n\n" + row.location);
        }
    }

    function fixSelectedTables() {
        var selected = selectedRows();
        var targets = [];
        var ineligible = 0;
        var i, row;
        var message;

        if (selected.length === 0) {
            alert("Select one or more TableFix candidates first.");
            return;
        }

        styles = resolveStyles(app.activeDocument);
        if (!styles.requiredPresent) {
            alert("TableFix cannot remediate tables until all three required paragraph styles resolve exactly once:\n\n" +
                  TABLE_HEADING_STYLE + "\n" + TABLE_FIRST_COLUMN_STYLE + "\n" + TABLE_OTHER_COLUMNS_STYLE +
                  "\n\nNo change was made.");
            return;
        }

        for (i = 0; i < selected.length; i++) {
            row = selected[i];
            if (row.fixable && row.table !== null && valid(row.table)) {
                targets.push(row);
            } else {
                ineligible++;
            }
        }

        if (targets.length === 0) {
            alert("None of the selected tables are eligible for automatic remediation.\n\n" +
                  "Only HIGH-confidence, non-complex candidates are fixable. REVIEW and merged/spanned tables are locate-only.");
            return;
        }

        message = "TableFix will remediate " + targets.length + " selected table(s).\n\n" +
                  "For each eligible table it will:\n" +
                  "  - set the visual top row to HEADER_ROW if needed;\n" +
                  "  - apply Table Heading to the header row;\n" +
                  "  - apply Table First Column below the header in column 1;\n" +
                  "  - apply Table Other Columns below the header in remaining columns;\n" +
                  "  - clear paragraph-only overrides;\n" +
                  "  - preserve character styles and red CLI text;\n" +
                  "  - preserve existing cell fills, including alternating gray/no-fill rows.\n\n" +
                  "Merged/spanned tables are never changed automatically.";

        if (ineligible > 0) {
            message += "\n\nSelected but ineligible tables that will be skipped: " + ineligible;
        }

        if (!confirm(message + "\n\nContinue?")) {
            return;
        }

        fixTables(targets);
    }

    function fixTables(targets) {
        var fixedCount = 0;
        var skippedCount = 0;
        var failedCount = 0;
        var fillRestoreCount = 0;
        var oldRedraw = null;
        var i, outcome;
        var failureNotes = [];

        status("Remediating " + targets.length + " selected table(s)...");

        try {
            oldRedraw = app.scriptPreferences.enableRedraw;
            app.scriptPreferences.enableRedraw = false;
        } catch (eRedraw) {}

        try {
            for (i = 0; i < targets.length; i++) {
                outcome = fixOneTable(targets[i]);
                fillRestoreCount += outcome.fillRestored;
                if (outcome.status === "fixed") {
                    fixedCount++;
                } else if (outcome.status === "skipped") {
                    skippedCount++;
                } else {
                    failedCount++;
                    if (failureNotes.length < 5 && outcome.reason.length > 0) {
                        failureNotes.push(outcome.reason);
                    }
                }
            }
        } finally {
            if (oldRedraw !== null) {
                try { app.scriptPreferences.enableRedraw = oldRedraw; } catch (eRestore) {}
            }
        }

        scan();

        alert("TableFix selected remediation complete.\n\n" +
              "Corrected and verified: " + fixedCount + "\n" +
              "Skipped: " + skippedCount + "\n" +
              "Could not verify: " + failedCount + "\n" +
              "Cell fills restored after semantic changes: " + fillRestoreCount +
              (failureNotes.length > 0 ? "\n\nFirst verification notes:\n" + failureNotes.join("\n") : "") +
              "\n\nThe document was rescanned. Review the changed tables before saving the document.");
    }

    function fixOneTable(row) {
        var table = row.table;
        var topRow;
        var visual;
        var complex;
        var headerCount;
        var fillSnapshot;
        var charStyleBefore;
        var redBefore;
        var fillRestored = 0;
        var r, c, tableRow, cell, expectedStyle;
        var styleAudit;
        var charStyleAfter;
        var redAfter;
        var fillAfter;
        var reason = [];

        if (!valid(table) || table.rows.length === 0) {
            return {status: "skipped", reason: "Table is no longer valid.", fillRestored: 0};
        }

        topRow = table.rows.item(0);
        visual = visualHeaderEvidence(topRow);
        headerCount = safeNumber(table, "headerRowCount", 0);
        complex = complexTableInfo(table, headerCount);

        if (visual.confidence !== "HIGH" || complex.isComplex) {
            return {status: "skipped", reason: "Table no longer meets HIGH/non-complex eligibility.", fillRestored: 0};
        }

        styles = resolveStyles(app.activeDocument);
        if (!styles.requiredPresent) {
            return {status: "skipped", reason: "Required paragraph styles no longer resolve.", fillRestored: 0};
        }

        fillSnapshot = captureCellFills(table);
        charStyleBefore = characterStyleSignature(table);
        redBefore = redCharacterSignature(table);

        try {
            if (!isHeaderRow(topRow)) {
                topRow.rowType = RowTypes.HEADER_ROW;
            }

            applyStyleToRow(topRow, styles.heading);

            for (r = 1; r < table.rows.length; r++) {
                tableRow = table.rows.item(r);
                if (!valid(tableRow)) {
                    continue;
                }
                for (c = 0; c < tableRow.cells.length; c++) {
                    cell = tableRow.cells.item(c);
                    if (!valid(cell)) {
                        continue;
                    }
                    expectedStyle = c === 0 ? styles.first : styles.other;
                    applyStyleToCell(cell, expectedStyle);
                }
            }
        } catch (eFix) {
            reason.push("InDesign error at " + row.location + ": " + eFix.message);
        }

        fillRestored = restoreChangedCellFills(fillSnapshot);

        if (!isHeaderRow(table.rows.item(0))) {
            reason.push("HEADER_ROW could not be verified.");
        }

        styleAudit = auditExpectedParagraphStyles(table);
        if (!styleAudit.allClean) {
            reason.push("Expected paragraph styles or paragraph-only override state could not be verified.");
        }

        charStyleAfter = characterStyleSignature(table);
        if (charStyleBefore !== charStyleAfter) {
            reason.push("Applied character-style assignments changed.");
        }

        redAfter = redCharacterSignature(table);
        if (redBefore !== redAfter) {
            reason.push("Red character positions changed.");
        }

        fillAfter = cellFillSignature(table);
        if (fillSnapshot.signature !== fillAfter) {
            reason.push("Cell fills did not return to their pre-fix visual state.");
        }

        if (reason.length === 0) {
            return {status: "fixed", reason: "", fillRestored: fillRestored};
        }

        return {status: "failed", reason: row.location + " - " + reason.join(" "), fillRestored: fillRestored};
    }

    function applyStyleToRow(row, style) {
        var i, cell;
        for (i = 0; i < row.cells.length; i++) {
            cell = row.cells.item(i);
            if (valid(cell)) {
                applyStyleToCell(cell, style);
            }
        }
    }

    function applyStyleToCell(cell, style) {
        var paras, i, para;
        try {
            paras = cell.paragraphs;
            for (i = 0; i < paras.length; i++) {
                para = paras.item(i);
                if (!valid(para)) {
                    continue;
                }
                para.applyParagraphStyle(style, false);
                if (!clearParagraphOnlyOverrides(para)) {
                    throw new Error("Could not clear paragraph-only overrides.");
                }
            }
        } catch (e) {
            throw e;
        }
    }

    function clearParagraphOnlyOverrides(para) {
        try {
            para.clearOverrides(OverrideType.PARAGRAPH_ONLY);
            return true;
        } catch (eEnum) {}
        try {
            para.clearOverrides(PARAGRAPH_ONLY_OVERRIDE_VALUE);
            return true;
        } catch (eNumeric) {}
        return false;
    }

    function captureCellFills(table) {
        var items = [];
        var parts = [];
        var i, cell, fill, tint, key;

        for (i = 0; i < table.cells.length; i++) {
            cell = table.cells.item(i);
            if (!valid(cell)) {
                continue;
            }
            fill = safePropertyObject(cell, "fillColor");
            tint = safeNumber(cell, "fillTint", -9999);
            key = swatchKey(fill);
            items.push({cell: cell, fillColor: fill, fillTint: tint, key: key});
            parts.push(key + "@" + tint);
        }

        return {items: items, signature: parts.join("|")};
    }

    function restoreChangedCellFills(snapshot) {
        var restored = 0;
        var i, item, currentKey, currentTint;

        for (i = 0; i < snapshot.items.length; i++) {
            item = snapshot.items[i];
            if (!valid(item.cell)) {
                continue;
            }
            currentKey = swatchKey(safePropertyObject(item.cell, "fillColor"));
            currentTint = safeNumber(item.cell, "fillTint", -9999);
            if (currentKey !== item.key || Math.abs(currentTint - item.fillTint) > 0.001) {
                try {
                    if (item.fillColor !== null && item.fillColor !== undefined) {
                        item.cell.fillColor = item.fillColor;
                    }
                    if (item.fillTint !== -9999) {
                        item.cell.fillTint = item.fillTint;
                    }
                    restored++;
                } catch (eRestore) {}
            }
        }

        return restored;
    }

    function cellFillSignature(table) {
        var parts = [];
        var i, cell;
        for (i = 0; i < table.cells.length; i++) {
            cell = table.cells.item(i);
            if (!valid(cell)) {
                continue;
            }
            parts.push(swatchKey(safePropertyObject(cell, "fillColor")) + "@" + safeNumber(cell, "fillTint", -9999));
        }
        return parts.join("|");
    }

    function characterStyleSignature(table) {
        var parts = [];
        var i, cell, chars, j, ch;
        var current = null;
        var run = 0;
        var key;

        for (i = 0; i < table.cells.length; i++) {
            cell = table.cells.item(i);
            if (!valid(cell)) {
                continue;
            }
            parts.push("C" + i + ":");
            current = null;
            run = 0;
            try {
                chars = cell.characters;
                for (j = 0; j < chars.length; j++) {
                    ch = chars.item(j);
                    key = characterStyleKey(ch);
                    if (current === null) {
                        current = key;
                        run = 1;
                    } else if (key === current) {
                        run++;
                    } else {
                        parts.push(current + "x" + run + ";");
                        current = key;
                        run = 1;
                    }
                }
                if (current !== null) {
                    parts.push(current + "x" + run + ";");
                }
            } catch (eChars) {}
        }

        return parts.join("");
    }

    function characterStyleKey(ch) {
        var style;
        try {
            style = ch.appliedCharacterStyle;
            if (valid(style)) {
                return "ID" + String(style.id);
            }
            if (style !== null && style !== undefined && style.name !== undefined) {
                return "N" + String(style.name);
            }
        } catch (e) {}
        return "?";
    }

    function redCharacterSignature(table) {
        var parts = [];
        var i, cell, chars, j, ch;
        for (i = 0; i < table.cells.length; i++) {
            cell = table.cells.item(i);
            if (!valid(cell)) {
                continue;
            }
            try {
                chars = cell.characters;
                for (j = 0; j < chars.length; j++) {
                    ch = chars.item(j);
                    if (isRedColor(safePropertyObject(ch, "fillColor"))) {
                        parts.push(i + ":" + j);
                    }
                }
            } catch (eChars) {}
        }
        return parts.join("|");
    }

    function countCharacterStyleRuns(table, styleName) {
        var runs = 0;
        var i, cell, chars, j, ch, name, active = false;
        for (i = 0; i < table.cells.length; i++) {
            cell = table.cells.item(i);
            if (!valid(cell)) {
                continue;
            }
            active = false;
            try {
                chars = cell.characters;
                for (j = 0; j < chars.length; j++) {
                    ch = chars.item(j);
                    name = appliedCharacterStyleName(ch);
                    if (name === styleName) {
                        if (!active) {
                            runs++;
                            active = true;
                        }
                    } else {
                        active = false;
                    }
                }
            } catch (eChars) {}
        }
        return runs;
    }

    function appliedCharacterStyleName(ch) {
        try { return String(ch.appliedCharacterStyle.name); } catch (e) { return "<unknown>"; }
    }

    function isHeaderRow(row) {
        var value;
        try {
            value = row.rowType;
            return value === RowTypes.HEADER_ROW;
        } catch (eEnum) {}
        try {
            value = String(row.rowType).toUpperCase();
            return value.indexOf("HEADER") >= 0;
        } catch (eString) {}
        return false;
    }

    function locationOfTable(story, table, tableIndex) {
        var storyId = safeProperty(story, "id", "-");
        var frame = null;
        var page = null;
        var frameId = "-";
        var pageName = "Overset/No page";
        var pageSort = 999999998;
        var ip;

        try {
            ip = table.rows.item(0).cells.item(0).texts.item(0).insertionPoints.item(0);
            if (ip.parentTextFrames && ip.parentTextFrames.length > 0) {
                frame = ip.parentTextFrames[0];
            }
        } catch (eFrame) {}

        if (frame !== null && valid(frame)) {
            frameId = safeProperty(frame, "id", "-");
            try { page = frame.parentPage; } catch (ePage) {}
        }

        if (page !== null && valid(page)) {
            pageName = safeProperty(page, "name", "?");
            try { pageSort = Number(page.documentOffset); } catch (eOffset) {}
        }

        return {
            page: pageName,
            pageSort: pageSort,
            storyId: storyId,
            frameId: frameId,
            pageRef: page,
            text: "Page " + pageName + " | Story " + storyId + " | Table " + tableIndex
        };
    }

    function previewRow(row) {
        var parts = [];
        var i, s;
        for (i = 0; i < row.cells.length; i++) {
            s = cleanText(safeContents(row.cells.item(i)));
            if (s.length > 40) {
                s = s.substring(0, 37) + "...";
            }
            if (s.length === 0) {
                s = "<empty>";
            }
            parts.push(s);
        }
        s = parts.join(" | ");
        if (s.length > 180) {
            s = s.substring(0, 177) + "...";
        }
        return s;
    }

    function saveCSV() {
        var doc = app.activeDocument;
        var name = baseName(doc) + "_TableFix_" + timestamp() + ".csv";
        var target = defaultFile(doc, name).saveDlg("Save TableFix CSV", "CSV:*.csv");
        var f, i, row;

        if (target === null) {
            return;
        }
        if (!/\.csv$/i.test(target.name)) {
            target = new File(target.fsName + ".csv");
        }

        f = new File(target.fsName);
        f.encoding = "UTF-8";
        f.lineFeed = "Windows";
        if (!f.open("w")) {
            alert("TableFix could not open the selected file for writing.");
            return;
        }

        f.writeln(csv([
            "Severity", "Code", "Confidence", "Page", "Story ID", "Frame ID", "Table Index", "Table ID",
            "Rows", "Columns", "Header Cells", "Black Header Cells", "Black Ratio", "Non-empty Header Cells",
            "White Header Text Cells", "White Ratio", "Aptos Bold 10 Header Cells", "Header Format Ratio",
            "HEADER_ROW", "Header Row Count", "Complex", "Complex Reason", "Merged/Spanned Cells",
            "Header Paragraphs", "Header Clean", "First Column Paragraphs", "First Column Clean",
            "Other Column Paragraphs", "Other Column Clean", "Paragraph Overrides", "CLI Code Red Table Runs",
            "Required Styles Present", "Fixable", "Fully Compliant", "Location", "Preview", "Finding", "Suggested Action"
        ]));

        for (i = 0; i < rows.length; i++) {
            row = rows[i];
            f.writeln(csv([
                row.severity, row.code, row.confidence, row.page, row.storyId, row.frameId,
                row.tableIndex, row.tableId, row.rowCount, row.columnCount, row.cellCount,
                row.blackCells, percent(row.blackRatio), row.nonEmptyCells, row.whiteTextCells,
                percent(row.whiteRatio), row.aptosBold10Cells, percent(row.formatRatio),
                yesNo(row.headerRow), row.headerRowCount, yesNo(row.complex), row.complexReason,
                row.mergedCellCount, row.headerParagraphs, row.headerClean, row.firstColumnParagraphs,
                row.firstColumnClean, row.otherColumnParagraphs, row.otherColumnClean, row.paragraphOverrides,
                row.cliRedRuns, yesNo(row.requiredStylesPresent), yesNo(row.fixable), yesNo(row.fullyCompliant),
                row.location, row.preview, row.finding, row.action
            ]));
        }

        f.close();
        status("CSV saved: " + target.fsName);
        alert("TableFix CSV saved.\n\n" + target.fsName);
    }

    function resolveStyles(doc) {
        var heading = findParagraphStyle(doc, TABLE_HEADING_STYLE);
        var first = findParagraphStyle(doc, TABLE_FIRST_COLUMN_STYLE);
        var other = findParagraphStyle(doc, TABLE_OTHER_COLUMNS_STYLE);
        var cli = findCharacterStyle(doc, CLI_RED_TABLE_STYLE);
        return {
            heading: heading,
            first: first,
            other: other,
            cliRed: cli,
            requiredPresent: heading !== null && first !== null && other !== null
        };
    }

    function findParagraphStyle(doc, name) {
        var stylesList, match = null, matches = 0, i, style;
        try {
            stylesList = doc.allParagraphStyles;
            for (i = 0; i < stylesList.length; i++) {
                style = stylesList[i];
                if (valid(style) && String(style.name) === name) {
                    match = style;
                    matches++;
                }
            }
        } catch (eAll) {}
        if (matches === 1) {
            return match;
        }
        if (matches > 1) {
            return null;
        }
        try {
            style = doc.paragraphStyles.itemByName(name);
            if (valid(style)) {
                return style;
            }
        } catch (eTop) {}
        return null;
    }

    function findCharacterStyle(doc, name) {
        var stylesList, match = null, matches = 0, i, style;
        try {
            stylesList = doc.allCharacterStyles;
            for (i = 0; i < stylesList.length; i++) {
                style = stylesList[i];
                if (valid(style) && String(style.name) === name) {
                    match = style;
                    matches++;
                }
            }
        } catch (eAll) {}
        if (matches === 1) {
            return match;
        }
        if (matches > 1) {
            return null;
        }
        try {
            style = doc.characterStyles.itemByName(name);
            if (valid(style)) {
                return style;
            }
        } catch (eTop) {}
        return null;
    }

    function isBlackColor(value) {
        var name = normalizedColorName(value);
        var vals;
        if (name === "black") {
            return true;
        }
        vals = colorValues(value);
        if (vals !== null) {
            if (vals.length === 4 && vals[0] <= 5 && vals[1] <= 5 && vals[2] <= 5 && vals[3] >= 90) {
                return true;
            }
            if (vals.length === 3 && vals[0] <= 20 && vals[1] <= 20 && vals[2] <= 20) {
                return true;
            }
        }
        return false;
    }

    function isWhiteColor(value) {
        var name = normalizedColorName(value);
        var vals;
        if (name === "paper" || name === "white") {
            return true;
        }
        vals = colorValues(value);
        if (vals !== null) {
            if (vals.length === 4 && vals[0] <= 5 && vals[1] <= 5 && vals[2] <= 5 && vals[3] <= 5) {
                return true;
            }
            if (vals.length === 3 && vals[0] >= 245 && vals[1] >= 245 && vals[2] >= 245) {
                return true;
            }
        }
        return false;
    }

    function isRedColor(value) {
        var name = normalizedColorName(value);
        var vals;
        if (name === "red") {
            return true;
        }
        vals = colorValues(value);
        if (vals !== null) {
            if (vals.length === 4 && vals[0] <= 10 && vals[1] >= 85 && vals[2] >= 85 && vals[3] <= 15) {
                return true;
            }
            if (vals.length === 3 && vals[0] >= 180 && vals[1] <= 90 && vals[2] <= 90) {
                return true;
            }
        }
        return false;
    }

    function normalizedColorName(value) {
        var name = "";
        if (value === null || value === undefined) {
            return name;
        }
        try { name = String(value.name); } catch (eName) {
            try { name = String(value); } catch (eString) { name = ""; }
        }
        name = name.toLowerCase();
        name = name.replace(/[\[\]]/g, "");
        name = name.replace(/^\s+|\s+$/g, "");
        return name;
    }

    function swatchKey(value) {
        if (value === null || value === undefined) {
            return "<none>";
        }
        try {
            if (valid(value)) {
                return "ID" + String(value.id) + ":" + String(value.name);
            }
        } catch (eValid) {}
        try { return "N:" + String(value.name); } catch (eName) {}
        try { return "S:" + String(value); } catch (eString) {}
        return "<?>";
    }

    function colorValues(value) {
        var vals, out = [], i;
        if (value === null || value === undefined) {
            return null;
        }
        try {
            vals = value.colorValue;
            if (vals === null || vals === undefined || vals.length === undefined) {
                return null;
            }
            for (i = 0; i < vals.length; i++) {
                out.push(Number(vals[i]));
            }
            return out;
        } catch (e) {}
        return null;
    }

    function isAptosBold10(textObject) {
        var fontName = "";
        var styleName = "";
        var size = -1;
        try {
            if (textObject.appliedFont && textObject.appliedFont.name !== undefined) {
                fontName = String(textObject.appliedFont.name);
            } else {
                fontName = String(textObject.appliedFont);
            }
        } catch (eFont) {}
        try { styleName = String(textObject.fontStyle); } catch (eStyle) {}
        try { size = Number(textObject.pointSize); } catch (eSize) {}

        return fontName.toLowerCase().indexOf("aptos") >= 0 &&
               styleName.toLowerCase().indexOf("bold") >= 0 &&
               Math.abs(size - 10) < 0.05;
    }

    function paragraphStyleName(para) {
        try { return String(para.appliedParagraphStyle.name); } catch (e) { return "<unknown>"; }
    }

    function cleanText(value) {
        var s = String(value);
        s = s.replace(/\u00A0/g, " ");
        s = s.replace(/[\r\n\t]+/g, " ");
        s = s.replace(/  +/g, " ");
        s = s.replace(/^ +| +$/g, "");
        return s;
    }

    function safeContents(obj) {
        try { return obj.contents; } catch (e) { return ""; }
    }

    function safeProperty(obj, name, fallback) {
        try { return String(obj[name]); } catch (e) { return fallback; }
    }

    function safeNumber(obj, name, fallback) {
        try {
            var n = Number(obj[name]);
            return isNaN(n) ? fallback : n;
        } catch (e) { return fallback; }
    }

    function safePropertyObject(obj, name) {
        try { return obj[name]; } catch (e) { return null; }
    }

    function valid(obj) {
        try { return obj !== null && obj.isValid === true; } catch (e) { return false; }
    }

    function sortRows() {
        rows.sort(function (a, b) {
            if (a.pageSort !== b.pageSort) {
                return a.pageSort - b.pageSort;
            }
            if (Number(a.storyId) !== Number(b.storyId)) {
                return Number(a.storyId) - Number(b.storyId);
            }
            return Number(a.tableIndex) - Number(b.tableIndex);
        });
    }

    function percent(value) {
        return String(Math.round(value * 100)) + "%";
    }

    function yesNo(value) {
        return value ? "Yes" : "No";
    }

    function fixed(value, width) {
        var s = String(value);
        while (s.length < width) { s += " "; }
        if (s.length > width) { s = s.substring(0, width - 3) + "..."; }
        return s;
    }

    function csv(values) {
        var out = [], i, s;
        for (i = 0; i < values.length; i++) {
            s = String(values[i]).replace(/"/g, "\"\"");
            out.push("\"" + s + "\"");
        }
        return out.join(",");
    }

    function defaultFile(doc, name) {
        var folder = Folder.desktop;
        try {
            if (doc.saved && doc.filePath && doc.filePath.exists) {
                folder = doc.filePath;
            }
        } catch (e) {}
        return new File(folder.fsName + "/" + name);
    }

    function docName(doc) {
        try { return String(doc.name); } catch (e) { return "Active document"; }
    }

    function baseName(doc) {
        return docName(doc).replace(/\.indd$/i, "").replace(/[\\\/:*?"<>|]/g, "_");
    }

    function timestamp() {
        var d = new Date();
        return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + "-" +
               two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
    }

    function two(n) { return n < 10 ? "0" + n : String(n); }

    function status(text) {
        ui.status.text = text;
        try { ui.win.update(); } catch (e) {}
    }

    function errorLine(err) {
        try { return err.line; } catch (e) { return "?"; }
    }
}());