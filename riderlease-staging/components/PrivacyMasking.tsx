import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { UploadIcon, DownloadIcon, CloseIcon, ShieldIcon } from './icons/IconComponents';

export const PrivacyMasking: React.FC = () => {
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [maskedImage, setMaskedImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setOriginalImage(event.target?.result as string);
                setMaskedImage(null);
                setError(null);
            };
            reader.readAsDataURL(file);
        }
    };

    const processMasking = async () => {
        if (!originalImage) return;

        setLoading(true);
        setError(null);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            
            // 1. Prepare Image Part
            const base64Data = originalImage.split(',')[1];
            const imagePart = {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data,
                },
            };

            // 2. Request Gemini to find RRN area
            // We ask for normalized coordinates of the last 7 digits of any Resident Registration Number found.
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [
                    {
                        parts: [
                            imagePart,
                            { text: "Find all Korean Resident Registration Numbers (주민등록번호) in this image. For each one, provide the bounding box coordinates [ymin, xmin, ymax, xmax] strictly covering ONLY the last 7 digits (뒷자리). Return the result as a JSON array of objects, where each object has a 'box' property with these 4 normalized coordinates (0-1000)." }
                        ]
                    }
                ],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            rrn_boxes: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        box: {
                                            type: Type.ARRAY,
                                            items: { type: Type.NUMBER },
                                            description: "[ymin, xmin, ymax, xmax] normalized 0-1000"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            const result = JSON.parse(response.text || '{"rrn_boxes": []}');
            const boxes = result.rrn_boxes || [];

            if (boxes.length === 0) {
                setError("이미지에서 주민등록번호를 찾을 수 없거나 이미 마스킹되어 있습니다.");
                setLoading(false);
                return;
            }

            // 3. Draw on Canvas and Blur
            applyMaskingToCanvas(boxes);

        } catch (err: any) {
            console.error("Masking Error:", err);
            setError("AI 분석 중 오류가 발생했습니다. 다시 시도해주세요.");
        } finally {
            setLoading(false);
        }
    };

    const applyMaskingToCanvas = (boxes: any[]) => {
        const img = new Image();
        img.onload = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Set canvas size to match image
            canvas.width = img.width;
            canvas.height = img.height;

            // Draw original image
            ctx.drawImage(img, 0, 0);

            // Apply masks for each detected box
            boxes.forEach(item => {
                const [ymin, xmin, ymax, xmax] = item.box;
                
                // Convert normalized (0-1000) to actual pixel coordinates
                const x = (xmin / 1000) * canvas.width;
                const y = (ymin / 1000) * canvas.height;
                const width = ((xmax - xmin) / 1000) * canvas.width;
                const height = ((ymax - ymin) / 1000) * canvas.height;

                // Create a blurred or solid rectangle
                // For privacy, we'll use a deep indigo solid rectangle with a slight blur effect around it
                ctx.save();
                
                // Option 1: Solid Box (Most Secure)
                ctx.fillStyle = '#1e1b4b'; // Deep Indigo
                ctx.fillRect(x - 2, y - 2, width + 4, height + 4);
                
                // Option 2: Heavy Blur on top of it for aesthetics
                ctx.filter = 'blur(8px)';
                ctx.fillStyle = 'rgba(30, 27, 75, 0.8)';
                ctx.fillRect(x, y, width, height);
                
                ctx.restore();
            });

            setMaskedImage(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.src = originalImage!;
    };

    const downloadResult = () => {
        if (!maskedImage) return;
        const link = document.createElement('a');
        link.download = `masked_document_${Date.now()}.jpg`;
        link.href = maskedImage;
        link.click();
    };

    const reset = () => {
        setOriginalImage(null);
        setMaskedImage(null);
        setError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <div className="p-8 space-y-8 animate-fade-in">
            <header className="flex justify-between items-center">
                <div>
                    <h2 className="text-3xl font-bold text-white flex items-center">
                        <ShieldIcon className="w-8 h-8 mr-3 text-indigo-400" />
                        개인정보 자동 마스킹
                    </h2>
                    <p className="text-slate-400 mt-2">AI가 신분증 및 계약서의 주민등록번호 뒷자리를 자동으로 찾아 비식별화합니다.</p>
                </div>
            </header>

            {!originalImage ? (
                <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 rounded-2xl p-16 flex flex-col items-center justify-center bg-slate-800/30 hover:bg-slate-800/50 hover:border-indigo-500 cursor-pointer transition-all group"
                >
                    <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                        <UploadIcon className="w-10 h-10 text-indigo-400" />
                    </div>
                    <p className="text-xl font-bold text-white">이미지 파일을 업로드하세요</p>
                    <p className="text-slate-500 mt-2">JPG, PNG 파일 지원 (최대 10MB)</p>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileChange} 
                        className="hidden" 
                        accept="image/*" 
                    />
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Source View */}
                    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-white">원본 이미지</h3>
                            <button onClick={reset} className="text-slate-500 hover:text-white transition-colors">
                                <CloseIcon className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="flex-grow flex items-center justify-center bg-slate-900 rounded-lg overflow-hidden border border-slate-700 min-h-[400px] relative">
                            <img src={originalImage} alt="Original" className="max-w-full max-h-[600px] object-contain" />
                            {loading && (
                                <div className="absolute inset-0 bg-slate-900/60 flex flex-col items-center justify-center">
                                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
                                    <p className="text-white font-medium">AI가 개인정보 영역을 분석 중입니다...</p>
                                </div>
                            )}
                        </div>
                        {!maskedImage && !loading && (
                            <button 
                                onClick={processMasking}
                                className="mt-6 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center"
                            >
                                <ShieldIcon className="w-5 h-5 mr-2" />
                                마스킹 실행하기
                            </button>
                        )}
                    </div>

                    {/* Result View */}
                    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 flex flex-col">
                        <h3 className="font-bold text-white mb-4">마스킹 결과</h3>
                        <div className="flex-grow flex items-center justify-center bg-slate-900 rounded-lg overflow-hidden border border-slate-700 min-h-[400px]">
                            {maskedImage ? (
                                <img src={maskedImage} alt="Masked Result" className="max-w-full max-h-[600px] object-contain animate-fade-in" />
                            ) : (
                                <div className="text-slate-600 text-center p-8">
                                    {error ? (
                                        <div className="text-red-400">
                                            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <p className="font-medium">{error}</p>
                                            <button onClick={reset} className="mt-4 text-indigo-400 hover:underline text-sm">다른 파일로 다시 시도</button>
                                        </div>
                                    ) : (
                                        <p>마스킹 실행 버튼을 누르면 결과가 표시됩니다.</p>
                                    )}
                                </div>
                            )}
                        </div>
                        {maskedImage && (
                            <div className="grid grid-cols-2 gap-4 mt-6">
                                <button 
                                    onClick={reset}
                                    className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 rounded-xl transition-all"
                                >
                                    다른 이미지
                                </button>
                                <button 
                                    onClick={downloadResult}
                                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-green-600/20 flex items-center justify-center"
                                >
                                    <DownloadIcon className="w-5 h-5 mr-2" />
                                    저장하기
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Hidden Canvas for Processing */}
            <canvas ref={canvasRef} className="hidden" />

            <section className="bg-slate-800/30 rounded-xl p-6 border border-slate-700/50">
                <h4 className="text-white font-bold mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    이용 안내
                </h4>
                <ul className="text-sm text-slate-400 space-y-2 list-disc list-inside">
                    <li>주민등록번호 뒷자리(7자리)를 자동으로 감지하여 가려줍니다.</li>
                    <li>이 기능은 브라우저 내에서 처리되나, 분석을 위해 이미지가 AI 서버로 일시 전송됩니다.</li>
                    <li>복잡한 배경이나 저화질 사진의 경우 인식이 부정확할 수 있으니 결과물을 반드시 확인하세요.</li>
                    <li>신분증(주민등록증, 운전면허증) 및 각종 계약서 서식에 최적화되어 있습니다.</li>
                </ul>
            </section>
        </div>
    );
};