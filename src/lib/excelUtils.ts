import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';

export interface InvoiceItem {
  stt: string | number;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: string;
  taxAmount: number;
}

export function exportToExcel(data: InvoiceItem[], filename: string = 'invoice_data.xlsx') {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Hóa đơn');
  
  // Write the file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' });
  
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
