/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { Upload, FileText, Download, Loader2, Table as TableIcon, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { exportToExcel, InvoiceItem } from './lib/excelUtils';

// Configure PDF.js worker - Using Vite's asset URL for local reliability
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<InvoiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setExtractedData([]);
      setError(null);
      generatePreviews(selectedFile);
    } else {
      setError('Vui lòng chọn một tệp PDF hợp lệ.');
    }
  };

  const generatePreviews = async (pdfFile: File) => {
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      // Using an object for parameters is more robust in recent PDF.js versions
      const loadingTask = pdfjs.getDocument({
        data: arrayBuffer,
      });
      const pdf = await loadingTask.promise;
      const images: string[] = [];

      // Render only the first 3 pages if it's long, to avoid overloading
      const numPages = Math.min(pdf.numPages, 5);
      
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (context) {
          await page.render({ 
            canvasContext: context, 
            viewport,
            // @ts-ignore
            canvas: canvas
          }).promise;
          images.push(canvas.toDataURL('image/jpeg', 0.8));
        }
      }
      setPreviewImages(images);
    } catch (err: any) {
      console.error('Error generating previews:', err);
      setError(`Không thể xử lý file PDF: ${err.message || 'Lỗi không xác định'}. Vui lòng thử lại.`);
    }
  };

  const extractData = async () => {
    if (!previewImages.length) return;
    
    setIsProcessing(true);
    setError(null);

    try {
      const imageDataParts = previewImages.map(img => ({
        inlineData: {
          mimeType: 'image/jpeg',
          data: img.split(',')[1]
        }
      }));

      const prompt = `
        Bạn là chuyên gia trích xuất dữ liệu hóa đơn. Hãy trích xuất danh sách tất cả hàng hóa/dịch vụ từ hóa đơn trong ảnh.
        Yêu cầu trích xuất bảng với các cột sau:
        - stt: Số thứ tự (nếu có, hoặc tự đánh số)
        - description: Tên/Mô tả hàng hóa, dịch vụ (Ví dụ: Máy tính xách tay Dell Vostro)
        - unit: Đơn vị tính (Ví dụ: Cái, Bộ, kg, Thùng)
        - quantity: Số lượng (Chỉ lấy giá trị số)
        - unitPrice: Đơn giá (Chỉ lấy giá trị số)
        - amount: Thành tiền (Chỉ lấy giá trị số)
        - taxRate: Thuế suất (Ví dụ: 8%, 10%, 0%, KCT - Không chịu thuế)
        - taxAmount: Tiền thuế (Chỉ lấy giá trị số)

        Lưu ý quan trọng:
        1. Nếu bảng kéo dài qua nhiều trang (ảnh), hãy nối chúng lại thành một danh sách liên tục.
        2. Chuyển đổi tất cả các giá trị số từ định dạng có dấu phẩy/chấm phân cách (ví dụ 1.200,50) sang số thuần túy (1200.5).
        3. Nếu một dòng là dòng tổng cộng hoặc chiết khấu mang tính chất dòng bảng, cũng có thể đưa vào nếu phù hợp hoặc bỏ qua nếu chỉ muốn danh mục hàng hóa. Ưu tiên lấy danh mục hàng hóa chi tiết.
        4. Phản hồi chỉ bằng định dạng JSON theo schema đã cung cấp.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          { parts: [...imageDataParts, { text: prompt }] }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                stt: { type: Type.STRING, description: 'Số thứ tự' },
                description: { type: Type.STRING, description: 'Tên hàng hóa, dịch vụ' },
                unit: { type: Type.STRING, description: 'Đơn vị tính' },
                quantity: { type: Type.NUMBER, description: 'Số lượng' },
                unitPrice: { type: Type.NUMBER, description: 'Đơn giá' },
                amount: { type: Type.NUMBER, description: 'Thành tiền' },
                taxRate: { type: Type.STRING, description: 'Thuế suất (ví dụ: 10%, 8%, KCT)' },
                taxAmount: { type: Type.NUMBER, description: 'Tiền thuế' }
              },
              required: ['description', 'amount']
            }
          }
        }
      });

      const text = response.text;
      if (text) {
        const data = JSON.parse(text);
        setExtractedData(data);
      }
    } catch (err: any) {
      console.error('Extraction error:', err);
      setError('Đã xảy ra lỗi khi trích xuất dữ liệu: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (extractedData.length > 0) {
      exportToExcel(extractedData, `hoadon_extracted_${new Date().getTime()}.xlsx`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-10 text-center flex flex-col items-center">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white mb-4 shadow-sm">
            <FileText className="w-6 h-6" />
          </div>
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl font-bold tracking-tight text-slate-900 mb-2"
          >
            Invoice Extractor Pro
          </motion.h1>
          <p className="text-slate-500 max-w-md">Trích xuất bảng hàng hóa từ hóa đơn PDF sang Excel chỉ trong vài giây bằng AI</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Upload & PDF Preview */}
          <section className="space-y-6">
            <div 
              className={`border-2 border-dashed rounded-2xl p-10 transition-all cursor-pointer bg-white 
                ${file ? 'border-indigo-200' : 'border-slate-300 hover:border-indigo-400'}`}
              onClick={() => !isProcessing && fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                className="hidden" 
                ref={fileInputRef} 
                accept=".pdf"
                onChange={handleFileChange}
              />
              <div className="flex flex-col items-center text-center gap-4">
                {file ? (
                  <>
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                      <FileText className="w-8 h-8 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-lg font-medium text-slate-900">{file.name}</p>
                      <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setFile(null); setPreviewImages([]); }}
                      className="text-sm font-medium text-red-500 hover:text-red-600"
                    >
                      Thay đổi file
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-400">
                      <Upload className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="text-lg font-medium text-slate-900">Kéo và thả file hóa đơn PDF vào đây</p>
                      <p className="text-sm text-slate-500 mt-1">Hoặc nhấp để chọn tệp (Tối đa 10MB)</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {previewImages.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                  <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400" /> Xem trước file
                  </h2>
                  <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-2 py-1 rounded uppercase tracking-wider">
                    {previewImages.length} Trang
                  </span>
                </div>
                <div className="max-h-[500px] overflow-y-auto p-4 space-y-4 bg-slate-50">
                  {previewImages.map((src, idx) => (
                    <img key={idx} src={src} alt={`Page ${idx + 1}`} className="w-full rounded-lg shadow-sm border border-slate-200" />
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Right Column: Processing & Results */}
          <section className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 min-h-[400px] flex flex-col overflow-hidden">
              {!file ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
                  <TableIcon className="w-12 h-12 mb-4 opacity-10" />
                  <p className="text-slate-400 font-medium">Bảng kết quả sẽ hiển thị tại đây</p>
                </div>
              ) : extractedData.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center space-y-8 p-10">
                  {isProcessing ? (
                    <>
                      <div className="relative">
                        <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse" />
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-medium text-slate-900">Đang phân tích hóa đơn</p>
                        <p className="text-sm text-slate-500 mt-2">AI đang trích xuất dữ liệu dòng hàng...</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
                        <CheckCircle2 className="w-10 h-10" />
                      </div>
                      <div className="text-center">
                        <h3 className="text-xl font-bold text-slate-900">File đã sẵn sàng</h3>
                        <p className="text-sm text-slate-500 mt-2 max-w-[280px] mx-auto">
                          Nhấn nút bên dưới để bắt đầu quá trình trích xuất thông tin hàng hóa
                        </p>
                      </div>
                      <button 
                        onClick={extractData}
                        disabled={isProcessing}
                        className="bg-indigo-600 text-white px-10 py-3.5 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                      >
                        Bắt đầu trích xuất bằng AI
                      </button>
                    </>
                  )}
                  {error && (
                    <div className="flex items-start gap-3 text-red-600 bg-red-50 p-4 rounded-xl border border-red-100 w-full max-w-sm">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <span className="text-sm font-medium leading-relaxed">{error}</span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                      <TableIcon className="w-4 h-4 text-indigo-600" /> Kết quả trích xuất
                    </h2>
                    <button 
                      onClick={handleDownload}
                      className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-emerald-700 transition-all shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" /> Xuất Excel (.xlsx)
                    </button>
                  </div>

                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] font-bold sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-3 border-b border-slate-100 w-12 text-center">STT</th>
                          <th className="px-6 py-3 border-b border-slate-100">Tên hàng hóa, dịch vụ</th>
                          <th className="px-6 py-3 border-b border-slate-100 text-right">Số lượng</th>
                          <th className="px-6 py-3 border-b border-slate-100 text-right">Đơn giá</th>
                          <th className="px-6 py-3 border-b border-slate-100 text-right">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        <AnimatePresence>
                          {extractedData.map((item, idx) => (
                            <motion.tr 
                              key={idx}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.03 }}
                              className="hover:bg-slate-50 transition-colors group"
                            >
                              <td className="px-6 py-4 text-slate-400 text-center font-mono text-xs">{item.stt || idx + 1}</td>
                              <td className="px-6 py-4 font-medium text-slate-800 leading-relaxed">{item.description}</td>
                              <td className="px-6 py-4 text-right text-slate-600 font-mono text-xs">{item.quantity}</td>
                              <td className="px-6 py-4 text-right text-slate-600 font-mono text-xs">{item.unitPrice?.toLocaleString()}</td>
                              <td className="px-6 py-4 text-right font-bold text-slate-900 font-mono text-xs">{item.amount?.toLocaleString()}</td>
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Summary Section matching reference */}
                  <div className="bg-slate-50 p-6 flex justify-end gap-8 md:gap-12 border-t border-slate-200">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Số lượng dòng</span>
                      <span className="text-lg font-semibold">{extractedData.length}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-indigo-600 uppercase font-bold tracking-wider">Tổng tiền (Dòng hàng)</span>
                      <span className="text-lg font-bold text-indigo-600">
                        {extractedData.reduce((acc, curr) => acc + (curr.amount || 0), 0).toLocaleString()} <span className="text-sm font-medium">đ</span>
                      </span>
                    </div>
                  </div>

                  <div className="px-6 py-3 bg-white flex items-center justify-between">
                    <p className="text-[10px] text-slate-400 italic">
                      * Trích xuất tự động bằng AI. Vui lòng kiểm tra lại.
                    </p>
                    <button 
                      onClick={() => { setExtractedData([]); setFile(null); setPreviewImages([]); }}
                      className="text-xs font-semibold text-slate-400 hover:text-red-500 transition-colors"
                    >
                      Xóa tất cả
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      <footer className="mt-16 text-center text-slate-400 text-xs pb-12">
        <p className="font-medium">© 2026 InvoiceScan Pro | Hệ thống xử lý hóa đơn thông minh</p>
      </footer>
    </div>
  );
}
