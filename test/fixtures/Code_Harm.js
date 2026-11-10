const HARM_SPREADSHEET_ID = '1Xy8HoZzPTrh0HARR0pVk6OWX9O0joYlPX6Vh0dsdcE4';
const HARM_SHEET_NAME = 'Harmonogram';

function getHarmData() {
  const ss = SpreadsheetApp.openById(HARM_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(HARM_SHEET_NAME);

  if (!sheet) {
    throw new Error('Nie znaleziono karty: ' + HARM_SHEET_NAME);
  }

  const startRow = 14;
  const lastRow = sheet.getLastRow();

  if (lastRow < startRow) {
    return { rows: [], holidays: [] };
  }

  const rowCount = lastRow - startRow + 1;

const lpValues      = sheet.getRange(startRow, 1, rowCount, 1).getDisplayValues();    // A - numer operacji
  const z1Values      = sheet.getRange(startRow, 2, rowCount, 1).getDisplayValues();    // B - Z1
  const z2Values      = sheet.getRange(startRow, 3, rowCount, 1).getDisplayValues();    // C - Z2
  const z3Values      = sheet.getRange(startRow, 4, rowCount, 1).getDisplayValues();    // D - Z3
  const z4Values      = sheet.getRange(startRow, 5, rowCount, 1).getDisplayValues();    // E - Z4
  const komisValues   = sheet.getRange(startRow, 7, rowCount, 1).getDisplayValues();    // G
  const elementValues = sheet.getRange(startRow, 8, rowCount, 1).getDisplayValues();    // H
  const startValues   = sheet.getRange(startRow, 9, rowCount, 1).getDisplayValues();    // I
  const godzinyValues = sheet.getRange(startRow, 11, rowCount, 1).getDisplayValues();   // K
  const koniecValues  = sheet.getRange(startRow, 13, rowCount, 1).getDisplayValues();   // M
  const wysylkaValues = sheet.getRange(startRow, 18, rowCount, 1).getDisplayValues();   // R
  const dostawaValues = sheet.getRange(startRow, 24, rowCount, 1).getDisplayValues();   // X

const stanowiskoValues      = sheet.getRange(startRow, 28, rowCount, 1).getDisplayValues();   // AB
  const stanowiskoBackgrounds = sheet.getRange(startRow, 28, rowCount, 1).getBackgrounds();
  const stanowiskoFontColors  = sheet.getRange(startRow, 28, rowCount, 1).getFontColors();
  const zakValues             = sheet.getRange(startRow, 20, rowCount, 1).getDisplayValues();   // T

  const setupSheet = ss.getSheetByName('setup');
  const holidays = setupSheet
    ? setupSheet.getRange('A2:A30').getDisplayValues().flat().filter(String)
    : [];

  const rows = [];

  for (let i = 0; i < rowCount; i++) {
const row = {
      rowIndex: startRow + i,

      lp:        lpValues[i][0],
      z1:        z1Values[i][0],
      z2:        z2Values[i][0],
      z3:        z3Values[i][0],
      z4:        z4Values[i][0],

      komis:     komisValues[i][0],
      element:   elementValues[i][0],
      start:     startValues[i][0],
      godziny:   godzinyValues[i][0],
      koniec:    koniecValues[i][0],
      wysylka:   wysylkaValues[i][0],
      dostawa:   dostawaValues[i][0],

stanowisko:    stanowiskoValues[i][0],
      stanowiskoBg:  stanowiskoBackgrounds[i][0],
      stanowiskoColor: stanowiskoFontColors[i][0],
      zak:           String(zakValues[i][0] || '').trim().toLowerCase()
    };

    if (
      row.komis ||
      row.element ||
      row.start ||
      row.koniec ||
      row.stanowisko
    ) {
      rows.push(row);
    }
  }

// Pobierz dane realizacji z Rap_m_h
  const rapSheet = ss.getSheetByName('Rap_m_h');
  const rapData = {};
  Logger.log('[RAP] Szukam arkusza Rap_m_h: ' + (rapSheet ? 'ZNALEZIONO' : 'BRAK'));
  if (rapSheet) {
    const rapLastCol = rapSheet.getLastColumn();
    const rapLastRow = rapSheet.getLastRow();
    Logger.log('[RAP] lastRow=' + rapLastRow + ' lastCol=' + rapLastCol);
    const stanowiskaRow = rapSheet.getRange(2, 2, 1, rapLastCol - 1).getDisplayValues()[0];
    Logger.log('[RAP] Stanowiska w wierszu 2: ' + JSON.stringify(stanowiskaRow));
    Logger.log('[RAP] Stanowiska w wierszu 1: ' + JSON.stringify(stanowiskaRow));
if (rapLastRow >= 4) {
      const rapValues = rapSheet.getRange(4, 1, rapLastRow - 3, rapLastCol).getDisplayValues();
      Logger.log('[RAP] Pierwszych 5 wierszy danych: ' + JSON.stringify(rapValues.slice(0, 5)));
      rapValues.forEach(function(row) {
        const komis = String(row[0] || '').trim();
        if (!komis) return;
        rapData[komis] = rapData[komis] || {};
        stanowiskaRow.forEach(function(st, idx) {
          const stKey = String(st || '').trim();
          if (!stKey) return;
          const val = parseFloat(String(row[idx + 1] || '').replace(',', '.'));
          if (!isNaN(val) && val > 0) {
            rapData[komis][stKey] = (rapData[komis][stKey] || 0) + val;
          }
        });
      });
    }
    Logger.log('[RAP] rapData: ' + JSON.stringify(rapData));
  }

  return {
    rows: rows,
    holidays: holidays,
    rapData: rapData,
    debug: {
      source: HARM_SPREADSHEET_ID,
      sheet: HARM_SHEET_NAME,
      startRow: startRow,
      rows: rows.length
    }
  };
}