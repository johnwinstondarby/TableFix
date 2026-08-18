#target "InDesign"
#targetengine "TableFix"

/*
TableFix v1.0
Read-only audit for visually formatted table header rows.

Primary visual signature:
  - top row of a table
  - black/dark cells across the row
  - white text in non-empty cells

Semantic checks:
  - row is already HEADER_ROW
  - paragraphs already use Table Heading

No document formatting is changed in v1.0.
ExtendScript / ECMAScript 3 compatible.
*/

(function () {
    var VERSION = "1.0";
    var TABLE_HEADING_STYLE = "Table Heading";
    var rows = [];
    var counts = null;
    var ui = {};
    var tableHeadingStyleExists = false;

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
        var s, t, story, table, topRow, result;

        rows = [];
        counts = {
            tablesScanned: 0,
            highCandidates: 0,
            reviewCandidates: 0,
            headerAlready: 0,
            headerMissing: 0,
            styleAlready: 0,
            styleMissing: 0,
            fullySemantic: 0
        };

        tableHeadingStyleExists = findParagraphStyle(doc, TABLE_HEADING_STYLE) !== null;
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
                    topRow = table.rows.item(0);
                    if (!valid(topRow)) {
                        continue;
                    }

                    result = auditTopRow(story, table, topRow, t);
                    if (result !== null) {
                        rows.push(result);
                    }
                }
            }

            sortRows();
            refresh(doc);
            if (rows.length > 0) {
                status("Scan complete. Select a candidate and click Locate, or double-click it.");
            } else {
                status("Scan complete. No visual table-header candidates were detected.");
            }
        } catch (eScan) {
            status("Scan failed: " + eScan.message);
            alert("TableFix scan failed.\n\n" + eScan.message + "\nLine: " + errorLine(eScan));
        } finally {
            if (oldRedraw !== null) {
                try {
                    app.scriptPreferences.enableRedraw = oldRedraw;
                } catch (eRestore) {}
            }
        }
    }

    function auditTopRow(story, table, row, tableIndex) {
        var cellCount = row.cells.length;
        var blackCells = 0;
        var nonEmptyCells = 0;
        var whiteTextCells = 0;
        var aptosBold11Cells = 0;
        var paragraphCount = 0;
        var tableHeadingParagraphs = 0;
        var normalParagraphs = 0;
        var otherParagraphs = 0;
        var i, cell, evidence, styleEvidence;
        var blackRatio, whiteRatio, formatRatio;
        var confidence = null;
        var header = isHeaderRow(row);
        var headerCount = safeNumber(table, "headerRowCount", 0);
        var loc = locationOfRow(story, table, row, tableIndex);
        var semanticStyleComplete;
        var semanticComplete;
        var severity;
        var code;
        var action;

        if (cellCount === 0) {
            return null;
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
                if (evidence.aptosBold11) {
                    aptosBold11Cells++;
                }
            }

            styleEvidence = paragraphStyleEvidence(cell);
            paragraphCount += styleEvidence.total;
            tableHeadingParagraphs += styleEvidence.tableHeading;
            normalParagraphs += styleEvidence.normal;
            otherParagraphs += styleEvidence.other;
        }

        blackRatio = cellCount > 0 ? blackCells / cellCount : 0;
        whiteRatio = nonEmptyCells > 0 ? whiteTextCells / nonEmptyCells : 0;
        formatRatio = nonEmptyCells > 0 ? aptosBold11Cells / nonEmptyCells : 0;

        if (blackRatio === 1 && nonEmptyCells > 0 && whiteRatio === 1) {
            confidence = "HIGH";
            counts.highCandidates++;
        } else if (blackRatio >= 0.75 && nonEmptyCells > 0 && whiteRatio >= 0.75) {
            confidence = "REVIEW";
            counts.reviewCandidates++;
        } else {
            return null;
        }

        semanticStyleComplete = paragraphCount > 0 && tableHeadingParagraphs === paragraphCount;
        semanticComplete = header && semanticStyleComplete;

        if (header) {
            counts.headerAlready++;
        } else {
            counts.headerMissing++;
        }
        if (semanticStyleComplete) {
            counts.styleAlready++;
        } else {
            counts.styleMissing++;
        }
        if (semanticComplete) {
            counts.fullySemantic++;
        }

        if (confidence === "REVIEW") {
            severity = "REVIEW";
            code = "TF-002";
        } else if (semanticComplete) {
            severity = "PASS";
            code = "";
        } else {
            severity = "WARNING";
            code = "TF-001";
        }

        action = suggestedAction(header, semanticStyleComplete);

        return {
            severity: severity,
            code: code,
            confidence: confidence,
            page: loc.page,
            pageSort: loc.pageSort,
            storyId: loc.storyId,
            frameId: loc.frameId,
            tableIndex: loc.tableIndex,
            rowIndex: safeProperty(row, "index", "0"),
            cellCount: cellCount,
            blackCells: blackCells,
            nonEmptyCells: nonEmptyCells,
            whiteTextCells: whiteTextCells,
            aptosBold11Cells: aptosBold11Cells,
            blackRatio: blackRatio,
            whiteRatio: whiteRatio,
            formatRatio: formatRatio,
            headerRow: header,
            headerRowCount: headerCount,
            paragraphCount: paragraphCount,
            tableHeadingParagraphs: tableHeadingParagraphs,
            normalParagraphs: normalParagraphs,
            otherParagraphs: otherParagraphs,
            tableHeadingStyleExists: tableHeadingStyleExists,
            preview: previewRow(row),
            location: loc.text,
            finding: findingText(confidence, header, semanticStyleComplete),
            action: action,
            row: row,
            pageRef: loc.pageRef
        };
    }

    function textEvidence(cell) {
        var text;
        var ranges;
        var i, range, content;
        var nonEmptyRanges = 0;
        var whiteRanges = 0;
        var formatRanges = 0;
        var nonEmptyCell = cleanText(safeContents(cell)).length > 0;

        if (!nonEmptyCell) {
            return {nonEmpty: false, white: true, aptosBold11: true};
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
                if (isAptosBold11(range)) {
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
                if (isAptosBold11(range)) {
                    formatRanges = 1;
                }
            } catch (eFallback) {}
        }

        return {
            nonEmpty: true,
            white: nonEmptyRanges > 0 && whiteRanges === nonEmptyRanges,
            aptosBold11: nonEmptyRanges > 0 && formatRanges === nonEmptyRanges
        };
    }

    function paragraphStyleEvidence(cell) {
        var result = {total: 0, tableHeading: 0, normal: 0, other: 0};
        var paras, i, para, name;

        try {
            paras = cell.texts.item(0).paragraphs;
            for (i = 0; i < paras.length; i++) {
                para = paras.item(i);
                if (!valid(para)) {
                    continue;
                }
                result.total++;
                name = paragraphStyleName(para);
                if (name === TABLE_HEADING_STYLE) {
                    result.tableHeading++;
                } else if (name === "Normal") {
                    result.normal++;
                } else {
                    result.other++;
                }
            }
        } catch (eParas) {}

        return result;
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

    function suggestedAction(header, styleComplete) {
        var parts = [];
        if (!tableHeadingStyleExists) {
            parts.push("Create Table Heading style");
        }
        if (!styleComplete) {
            parts.push("Apply Table Heading");
        }
        if (!header) {
            parts.push("Set HEADER_ROW");
        }
        if (parts.length === 0) {
            return "None";
        }
        return parts.join("; ");
    }

    function findingText(confidence, header, styleComplete) {
        var parts = [];
        if (confidence === "HIGH") {
            parts.push("Top row matches the black-cell / white-text visual header signature.");
        } else {
            parts.push("Top row partially matches the visual header signature and requires review.");
        }
        parts.push(header ? "HEADER_ROW is present." : "HEADER_ROW is missing.");
        parts.push(styleComplete ? "Table Heading is applied throughout the row." : "Table Heading is not applied throughout the row.");
        return parts.join(" ");
    }

    function locationOfRow(story, table, row, tableIndex) {
        var storyId = safeProperty(story, "id", "-");
        var frame = null;
        var page = null;
        var frameId = "-";
        var pageName = "Overset/No page";
        var pageSort = 999999998;
        var ip;

        try {
            ip = row.cells.item(0).texts.item(0).insertionPoints.item(0);
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
            tableIndex: tableIndex,
            pageRef: page,
            text: "Page " + pageName + " | Story " + storyId + " | Table " + tableIndex + " | Top row"
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

    function buildUI() {
        var buttons, button;

        ui.win = new Window("palette", "TableFix v" + VERSION);
        ui.win.orientation = "column";
        ui.win.alignChildren = ["fill", "top"];
        ui.win.margins = 12;
        ui.win.spacing = 8;

        ui.title = ui.win.add("statictext", undefined, "Visual Table Header Audit");
        try {
            ui.title.graphics.font = ScriptUI.newFont(ui.title.graphics.font.name, "BOLD", 15);
        } catch (eFont) {}

        ui.summary = ui.win.add("statictext", undefined, "", {multiline: true});
        ui.summary.preferredSize = [980, 82];

        ui.list = ui.win.add("listbox", undefined, [], {multiselect: false});
        ui.list.preferredSize = [980, 420];
        ui.list.onDoubleClick = locate;

        ui.status = ui.win.add("statictext", undefined, "");
        ui.status.preferredSize = [980, 32];

        buttons = ui.win.add("group");
        buttons.alignment = ["right", "top"];

        button = buttons.add("button", undefined, "Rescan");
        button.onClick = scan;

        button = buttons.add("button", undefined, "Locate");
        button.onClick = locate;

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
                   "Black " + fixed(percent(row.blackRatio), 5) + "  " +
                   "White " + fixed(percent(row.whiteRatio), 5) + "  " +
                   fixed(row.headerRow ? "HEADER" : "BODY", 7) + "  " +
                   fixed(row.tableHeadingParagraphs + "/" + row.paragraphCount + " styled", 11) + "  " +
                   row.preview;
            ui.list.add("item", line);
        }

        ui.summary.text = docName(doc) + "\n" +
            "Tables scanned: " + counts.tablesScanned +
            "    High-confidence visual headers: " + counts.highCandidates +
            "    Review candidates: " + counts.reviewCandidates + "\n" +
            "HEADER_ROW present: " + counts.headerAlready +
            "    HEADER_ROW missing: " + counts.headerMissing +
            "    Fully semantic: " + counts.fullySemantic + "\n" +
            "Table Heading style exists: " + (tableHeadingStyleExists ? "Yes" : "No") +
            "    Candidate rows fully using Table Heading: " + counts.styleAlready +
            "    Candidate rows needing style assignment: " + counts.styleMissing;

        try { ui.win.layout.layout(true); } catch (eLayout) {}
    }

    function locate() {
        var row, target, located = false;

        if (ui.list.selection === null) {
            alert("Select a TableFix candidate first.");
            return;
        }

        row = rows[ui.list.selection.index];
        if (!row || row.row === null || !valid(row.row)) {
            alert("This candidate no longer has a valid table row to locate.");
            return;
        }

        try {
            if (row.pageRef !== null && valid(row.pageRef)) {
                app.activeWindow.activePage = row.pageRef;
            }
        } catch (ePage) {}

        try {
            target = row.row.cells.item(0).texts.item(0);
            target.showText();
            located = true;
        } catch (eShow) {}

        try {
            app.select(target);
            located = true;
        } catch (eSelect) {
            try {
                app.select(row.row.cells.item(0).texts.item(0).insertionPoints.item(0));
                located = true;
            } catch (eIP) {}
        }

        if (located) {
            status("Located table header candidate at " + row.location + ".");
        } else {
            alert("InDesign could not navigate to this candidate.\n\n" + row.location);
        }
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
            "Severity", "Code", "Confidence", "Page", "Story ID", "Frame ID", "Table Index", "Row Index",
            "Cells", "Black Cells", "Black Ratio", "Non-empty Cells", "White Text Cells", "White Ratio",
            "Aptos Bold 11 Cells", "Format Ratio", "HEADER_ROW", "Header Row Count",
            "Paragraphs", "Table Heading Paragraphs", "Normal Paragraphs", "Other Paragraphs",
            "Table Heading Style Exists", "Location", "Preview", "Finding", "Suggested Action"
        ]));

        for (i = 0; i < rows.length; i++) {
            row = rows[i];
            f.writeln(csv([
                row.severity, row.code, row.confidence, row.page, row.storyId, row.frameId,
                row.tableIndex, row.rowIndex, row.cellCount, row.blackCells, percent(row.blackRatio),
                row.nonEmptyCells, row.whiteTextCells, percent(row.whiteRatio), row.aptosBold11Cells,
                percent(row.formatRatio), row.headerRow ? "Yes" : "No", row.headerRowCount,
                row.paragraphCount, row.tableHeadingParagraphs, row.normalParagraphs, row.otherParagraphs,
                row.tableHeadingStyleExists ? "Yes" : "No", row.location, row.preview, row.finding, row.action
            ]));
        }

        f.close();
        status("CSV saved: " + target.fsName);
        alert("TableFix CSV saved.\n\n" + target.fsName);
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

    function isAptosBold11(textObject) {
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
               Math.abs(size - 11) < 0.05;
    }

    function findParagraphStyle(doc, name) {
        var styles, match = null, matches = 0, i, style;
        try {
            styles = doc.allParagraphStyles;
            for (i = 0; i < styles.length; i++) {
                style = styles[i];
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
