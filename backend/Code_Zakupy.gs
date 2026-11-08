function getZakupyData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Zakupy');

  if (!sheet) {
    throw new Error('Nie znaleziono karty: Zakupy');
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2) {
    return { rows: [] };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

  const rows = values
    .filter(function(row) {
      return row.some(function(cell) {
        return String(cell || '').trim() !== '';
      });
    })
    .map(function(row, index) {
      return {
        rowNumber: index + 2,
        columnA: row[0] || '',
        columnB: row[1] || '',
        columnC: row[2] || '',
        columnD: row[3] || '',
        columnE: row[4] || '',
        columnF: row[5] || '',
        columnG: row[6] || '',
        columnH: row[7] || '',
        columnI: row[8] || '',
        columnJ: row[9] || '',
        columnK: row[10] || '',
columnL: row[11] || ''
      };
    });

  return { rows: rows };
}
function getZakupyProductCodes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PSWT');

  if (!sheet) {
    throw new Error('Nie znaleziono karty: PSWT');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];

  return sheet
    .getRange(1, 2, lastRow, 1) // B:B
    .getValues()
    .flat()
    .map(v => String(v || '').trim())
    .filter(v => v !== '');
}

function addZakupyItem(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Zakupy');

  if (!sheet) {
    throw new Error('Nie znaleziono karty: Zakupy');
  }

  data = data || {};

  const kod = String(data.kod || '').trim();
  const ilosc = String(data.ilosc || '').trim();

  // Kod może być pusty (nowy produkt bez kodu w bazie); wymagana jest tylko ilość.
  if (!ilosc) {
    throw new Error('Ilość jest wymagana.');
  }

  const row = sheet.getLastRow() + 1;


  sheet.getRange(row, 3).setValue(kod);              // C
  sheet.getRange(row, 4).setValue(ilosc);            // D
  if (data.cena) sheet.getRange(row, 6).setValue(data.cena); // F (tylko kopia po częściowym zakupie)
  sheet.getRange(row, 7).setValue(data.zmw || '');   // G
  sheet.getRange(row, 8).setValue(new Date());       // H Zamówiono
  sheet.getRange(row, 11).setValue(data.opis || ''); // K
  sheet.getRange(row, 12).setValue(data.uwagi || '');// L

  return {
    success: true,
    message: 'Dodano pozycję zakupu.'
  };
}

function updateZakupyItem(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Zakupy');

  if (!sheet) {
    throw new Error('Nie znaleziono karty: Zakupy');
  }

  data = data || {};

  const rowNumber = Number(data.rowNumber);
  if (!rowNumber || rowNumber < 2) {
    throw new Error('Nieprawidłowy numer wiersza.');
  }

  sheet.getRange(rowNumber, 2).setValue(data.zakup || '');          // B data zakupu
  sheet.getRange(rowNumber, 3).setValue(data.kod || '');            // C kod
  sheet.getRange(rowNumber, 4).setValue(data.iloscKupiona || '');   // D ilość zakupiona
  sheet.getRange(rowNumber, 5).setValue(data.pz || '');             // E PZ
  sheet.getRange(rowNumber, 6).setValue(data.cena || '');           // F cena
  sheet.getRange(rowNumber, 7).setValue(data.zmw || '');            // G ZMW
  sheet.getRange(rowNumber, 10).setValue('x');                      // J zakup zrealizowany
  sheet.getRange(rowNumber, 11).setValue(data.opis || '');          // K opis
  sheet.getRange(rowNumber, 12).setValue(data.uwagi || '');         // L uwagi

  return {
    success: true,
    message: 'Zapisano realizację zakupu.'
  };
}

function getZakupyArchiveData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Zakupy_ar');

  if (!sheet) {
    throw new Error('Nie znaleziono karty: Zakupy_ar');
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < 2) {
    return { rows: [] };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();

  const rows = values
    .filter(function(row) {
      return row.some(function(cell) {
        return String(cell || '').trim() !== '';
      });
    })
    .map(function(row, index) {
      return {
        rowNumber: index + 2,
        columnA: row[0] || '',
        columnB: row[1] || '',
        columnC: row[2] || '',
        columnD: row[3] || '',
        columnE: row[4] || '',
        columnF: row[5] || '',
        columnG: row[6] || '',
        columnH: row[7] || '',
        columnI: row[8] || '',
        columnJ: row[9] || '',
        columnK: row[10] || '',
        columnL: row[11] || ''
      };
    });

  return { rows: rows };
}