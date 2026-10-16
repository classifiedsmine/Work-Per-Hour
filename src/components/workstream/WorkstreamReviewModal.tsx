import React, { useState } from 'react';
import { X, Star, AlertCircle, Loader2 } from 'lucide-react';
import { WorkstreamItem } from './types';

interface WorkstreamReviewModalProps {
  isOpen: boolean;
  order: WorkstreamItem;
  onClose: () => void;
  onSubmitReview: (review: { rating: number; comment: string; gigId?: string; projectId?: string }) => Promise<boolean>;
  error?: string | null;
  isSubmitting?: boolean;
}

export const WorkstreamReviewModal: React.FC<WorkstreamReviewModalProps> = ({
  isOpen,
  order,
  onClose,
  onSubmitReview,
  error: externalError,
  isSubmitting = false
}) => {
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('Excellent delivery! Fast turnaround and high quality.');
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) return null;

  const displayError = externalError || localError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (rating < 1 || rating > 5) {
      setLocalError('Please select a star rating between 1 and 5.');
      return;
    }

    if (!comment.trim()) {
      setLocalError('Please enter a feedback comment before submitting.');
      return;
    }

    const success = await onSubmitReview({
      rating,
      comment: comment.trim(),
      gigId: order.gigId,
      projectId: order.projectId
    });

    if (success) {
      setLocalError(null);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-50 text-amber-500 rounded-xl">
              <Star className="w-5 h-5 fill-amber-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-fiverr-dark">Write Review & Feedback</h3>
              <p className="text-[11px] text-slate-400">Order #{order.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {displayError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-600 flex items-start gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
            <div className="flex-1 font-medium">{displayError}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-fiverr-dark font-bold uppercase tracking-wider text-[10px] mb-2">
              Rate Freelancer's Work
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setRating(star);
                    setLocalError(null);
                  }}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 focus:outline-none transition-transform hover:scale-110 cursor-pointer disabled:opacity-50"
                >
                  <Star
                    className={`w-6 h-6 ${
                      star <= (hoverRating || rating)
                        ? 'text-yellow-400 fill-yellow-400'
                        : 'text-slate-200'
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 font-mono font-bold text-slate-600 text-sm">
                {hoverRating || rating}.0
              </span>
            </div>
          </div>

          <div>
            <label className="block text-fiverr-dark font-bold uppercase tracking-wider text-[10px] mb-1.5">
              Public Review & Feedback Note
            </label>
            <textarea
              rows={3}
              value={comment}
              disabled={isSubmitting}
              onChange={(e) => {
                setComment(e.target.value);
                setLocalError(null);
              }}
              placeholder="Share your experience working with this freelancer..."
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-fiverr-dark placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white resize-none leading-relaxed disabled:opacity-50"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-fiverr-dark font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-xs transition cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSubmitting ? 'Submitting...' : 'Submit Review'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
