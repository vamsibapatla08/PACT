import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { createPact } from '../services/pactService'

interface CreatePactModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function CreatePactModal({ open, onClose, onSuccess }: CreatePactModalProps) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setName('')
      setError(null)
      setSuccess(false)
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  // Escape key to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || success) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Please enter a pact name.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await createPact(trimmed)
      setSuccess(true)
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 900)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [name, loading, success, onSuccess, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-labelledby="create-pact-title"
        >
          <motion.div
            className="modal-box"
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title" id="create-pact-title">Create a Pact</h2>
              <button
                className="modal-close-btn"
                onClick={onClose}
                aria-label="Close modal"
                type="button"
              >
                ✕
              </button>
            </div>

            <p className="modal-sub">Name your shared plan. You can invite others after it's created.</p>

            <form onSubmit={handleSubmit} noValidate>
              <div className="modal-field">
                <label className="modal-label" htmlFor="pact-name">
                  Pact Name
                </label>
                <input
                  ref={inputRef}
                  id="pact-name"
                  className="modal-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Cabo Trip 2026"
                  disabled={loading || success}
                  autoComplete="off"
                />
                <div className="modal-char-count">{name.length}/80</div>
              </div>

              {error && <div className="modal-error" role="alert">{error}</div>}
              {success && <div className="modal-success" role="status">Pact created! ✓</div>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={onClose}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal-submit-btn"
                  disabled={loading || success || !name.trim()}
                >
                  {loading ? (
                    <span className="spinner" style={{ width: 16, height: 16 }} />
                  ) : success ? (
                    'Created ✓'
                  ) : (
                    'Create Pact'
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
