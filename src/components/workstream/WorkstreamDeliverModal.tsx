import React, { useState, useRef } from 'react';
import { X, Send, Paperclip, FileText, CheckCircle2, Link as LinkIcon } from 'lucide-react';
import { WorkstreamItem } from './types';
import { uploadWorkstreamFile } from '../../utils/workstreamUpload';

interface WorkstreamDeliverModalProps {
  isOpen: boolean;
  order: WorkstreamItem;
  onClose: () => void;
  onSubmitDelivery: (delivery: {
    notes: string;
    reference?: string;
    files: Array<{ name: string; size: string; url: string }>;
  }) => void | Promise<boolean | void>;
}

export const WorkstreamDeliverModal: React.FC<WorkstreamDeliverModalProps> = ({
  isOpen,
  order,
  onClose,
  onSubmitDelivery
}) => {
  const [notes, setNotes] = useState('Hi! I have completed all agreed deliverables for your review. Please inspect the submitted assets.');
  const [reference, setReference] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; size: string; url: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await uploadWorkstreamFile(file);
      setAttachedFiles(prev => [...prev, result]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFile = (idx: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim() && !reference.trim() && attachedFiles.length === 0) {
      alert('Add a file, a URL/reference link, or a written message to submit a delivery.');
      return;
    }

    await onSubmitDelivery({
      notes: notes.trim(),
      reference: reference.trim() || undefined,
      files: attachedFiles
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-slate-900 text-white rounded-xl">
              <Send className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-fiverr-dark">Submit Deliverables</h3>
              <p className="text-[11px] text-slate-400">Order #{order.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-fiverr-dark font-bold uppercase tracking-wider text-[10px] mb-1.5">
              Delivery Notes & Completion Presentation
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explain deliverables, provide live test links, or include installation steps..."
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-fiverr-dark placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white resize-none leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-fiverr-dark font-bold uppercase tracking-wider text-[10px] mb-1.5 flex items-center gap-1">
              <LinkIcon className="w-3 h-3 text-slate-500" />
              <span>Reference Link / Live Deliverable URL (Optional)</span>
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. https://github.com/myorg/project or Figma preview link"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-fiverr-dark placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white"
            />
            <p className="text-[10px] text-slate-400 mt-1">Rendered as plain text verbatim for client verification.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-fiverr-dark font-bold uppercase tracking-wider text-[10px]">
                Deliverable Files ({attachedFiles.length})
              </label>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[11px] text-emerald-600 font-bold hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Paperclip className="w-3.5 h-3.5" />
                <span>Attach File</span>
              </button>
            </div>

            <div className="space-y-2 max-h-36 overflow-y-auto">
              {attachedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-bold text-fiverr-dark truncate">{file.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({file.size})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="text-slate-400 hover:text-red-500 text-xs px-1 cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 bg-blue-50/70 text-[11px] text-blue-800 rounded-2xl border border-blue-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Delivering updates the workstream status and notifies the buyer to inspect completed work.</span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-fiverr-dark font-bold rounded-xl text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs shadow-xs transition cursor-pointer"
            >
              Submit Deliverable
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
