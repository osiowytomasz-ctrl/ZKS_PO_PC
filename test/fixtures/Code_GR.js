const SCHEDULESHEET = "G";

function saveGrData(changes) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('G');

  if (!sheet) {
    throw new Error('Arkusz G nie istnieje!');
  }

  const extraRangeAddress = String(sheet.getRange('B3').getDisplayValue()).trim();

  if (!extraRangeAddress) {
    throw new Error('Brak adresu zakresu grafiku w komórce B3!');
  }

  const extraRange = sheet.getRange(extraRangeAddress);
  const startRow = extraRange.getRow();
  const startCol = extraRange.getColumn();

  changes.forEach(function(change) {
    const row = Number(change.row);
    const col = Number(change.col);

    if (isNaN(row) || isNaN(col)) return;

    sheet
      .getRange(startRow + row, startCol + col)
      .setValue(change.value || '');
  });

  SpreadsheetApp.flush();

  return {
    status: 'success',
    message: 'Grafik zapisany.'
  };
}

function getScheduleData() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SCHEDULESHEET);

  if (!sheet) {
    throw new Error("Arkusz o nazwie " + SCHEDULESHEET + " nie istnieje!");
  }

  const leftRangeAddress = String(sheet.getRange('A3').getValue()).trim();
  const scheduleRangeAddress = String(sheet.getRange('B3').getValue()).trim();

  if (!leftRangeAddress) {
    throw new Error("Brak adresu zakresu w komórce A3!");
  }

  if (!scheduleRangeAddress) {
    throw new Error("Brak adresu zakresu w komórce B3!");
  }

  const leftRange = sheet.getRange(leftRangeAddress);
  const scheduleRange = sheet.getRange(scheduleRangeAddress);

  return {
    leftValues: leftRange.getValues(),
    leftBackgrounds: leftRange.getBackgrounds(),
    leftFontColors: leftRange.getFontColors(),

    scheduleValues: scheduleRange.getValues(),
    scheduleBackgrounds: scheduleRange.getBackgrounds(),
    scheduleFontColors: scheduleRange.getFontColors()
  };
}

function getGrData(startDate, endDate) {

  Logger.log('[GR] START getGrData');
  Logger.log('[GR] startDate: ' + startDate);
  Logger.log('[GR] endDate: ' + endDate);

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('G');

  if (!sheet) {
    throw new Error('Arkusz G nie istnieje!');
  }

  const leftRangeAddress = String(sheet.getRange('A3').getDisplayValue()).trim();

  let extraRangeAddress = String(sheet.getRange('B3').getDisplayValue()).trim();

  if (startDate && endDate) {
    const headerRow = 4;
    const lastCol = sheet.getLastColumn();

    const headers = sheet
      .getRange(headerRow, 1, 1, lastCol)
      .getDisplayValues()[0];

    function dateToNumber_(value) {
      const text = String(value || '').trim();

      let iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) return Number(iso[1] + iso[2] + iso[3]);

      let pl = text.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
      if (pl) {
        let day = String(pl[1]).padStart(2, '0');
        let month = String(pl[2]).padStart(2, '0');
        let year = Number(pl[3]);
        if (year < 100) year += 2000;

        return Number(String(year) + month + day);
      }

      return null;
    }

    const startNumber = dateToNumber_(startDate);
    const endNumber = dateToNumber_(endDate);

    let startCol = null;
    let endCol = null;

    headers.forEach(function(header, index) {
      const dateNumber = dateToNumber_(header);

      if (!dateNumber) return;

      if (startCol === null && dateNumber >= startNumber) {
        startCol = index + 1;
      }

      if (dateNumber <= endNumber) {
        endCol = index + 1;
      }
    });

    Logger.log('[GR] startCol: ' + startCol);
    Logger.log('[GR] endCol: ' + endCol);

    if (!startCol || !endCol || endCol < startCol) {
      throw new Error('Nie znaleziono zakresu dat w wierszu 4 arkusza G.');
    }

    const b3Range = sheet.getRange(extraRangeAddress);
    const startRow = b3Range.getRow();
    const numRows = b3Range.getNumRows();
    const numCols = endCol - startCol + 1;

    extraRangeAddress =
      sheet.getRange(startRow, startCol, numRows, numCols).getA1Notation();

    Logger.log('[GR] dynamic extraRangeAddress: ' + extraRangeAddress);
  }

  const leftRange = sheet.getRange(leftRangeAddress);
  const extraRange = sheet.getRange(extraRangeAddress);

  const values = leftRange.getDisplayValues();
  const backgrounds = leftRange.getBackgrounds();
  const fontColors = leftRange.getFontColors();

  const extraValues = extraRange.getDisplayValues();
  const extraBackgrounds = extraRange.getBackgrounds();
  const extraFontColors = extraRange.getFontColors();

  const rows = values.map(function(row, index) {
    return {
      rowIndex: index,
      name: row[0],
      value: row[1],
      nameBg: backgrounds[index][0],
      valueBg: backgrounds[index][1],
      nameColor: fontColors[index][0],
      valueColor: fontColors[index][1]
    };
  });

  const GR_ALLOWED_EDITORS = [
    'osiowy.tomasz@gmail.com',
    'skupnikadam@gmail.com'
  ];

  const userEmail = currentUserEmail_();
  const canEdit = GR_ALLOWED_EDITORS.includes(userEmail);

  return {
    rows: rows,
    extraValues: extraValues,
    extraBackgrounds: extraBackgrounds,
    extraFontColors: extraFontColors,
    canEdit: canEdit,
    userEmail: userEmail,
    allowedEditors: GR_ALLOWED_EDITORS,
    debug: {
      version: 'GR_DYNAMIC_DATE_RANGE_1',
      rangeA3: leftRangeAddress,
      rangeB3: extraRangeAddress,
      rows: rows.length,
      extraRows: extraValues.length,
      startDate: startDate,
      endDate: endDate
    }
  };
}