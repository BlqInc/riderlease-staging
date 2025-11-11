export const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);
};

export const getDaysDifference = (dateString1: string, dateString2: string): number => {
    const date1 = new Date(dateString1);
    const date2 = new Date(dateString2);
    const differenceInTime = date2.getTime() - date1.getTime();
    return Math.floor(differenceInTime / (1000 * 3600 * 24));
};

export const exportGridToCsv = (filename: string, rows: (string|number|null|undefined)[][]) => {
    const processRow = (row: (string|number|null|undefined)[]) => {
        let finalVal = '';
        for (let j = 0; j < row.length; j++) {
            let innerValue = row[j] === null || row[j] === undefined ? '' : String(row[j]);
            if (String(row[j]).search(/("|,|\n)/g) >= 0)
                innerValue = '"' + innerValue.replace(/"/g, '""') + '"';
            if (j > 0)
                finalVal += ',';
            finalVal += innerValue;
        }
        return finalVal + '\n';
    };

    let csvContent = '\uFEFF'; // BOM for UTF-8
    rows.forEach(rowArray => {
      csvContent += processRow(rowArray);
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};