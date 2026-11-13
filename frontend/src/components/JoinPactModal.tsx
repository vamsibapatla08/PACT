import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { joinPact } from '../services/pactService'

interface JoinPactModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function JoinPactModal({ open, onClose, onSuccess }: JoinPactModalProps) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setError(null)
      setSuccess(false)
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

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
    const trimmed = code.trim().toLowerCase()
    if (!trimmed) {
      setError('Please enter an invite code.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await joinPact(trimmed)
      setSuccess(true)
      setTimeout(() => {
        onSuccess()
        onClose()
      }, 900)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [code, loading, success, onSuccess, onClose])

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
          aria-labelledby="join-pact-title"
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
              <h2 className="modal-title" id="join-pact-title">Join a Pact</h2>
              <button
                className="modal-close-btn"
                onClick={onClose}
                aria-label="Close modal"
                type="button"
              >
                ✕
              </button>
            </div>

            <p className="modal-sub">Enter the 8-character invite code shared by your group.</p>

            <form onSubmit={handleSubmit} noValidate>
              <div className="modal-field">
                <label className="modal-label" htmlFor="invite-code">
                  Invite Code
                </label>
                <input
                  ref={inputRef}
                  id="invite-code"
                  className="modal-input modal-input--code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={8}
                  placeholder="XXXXXXXX"
                  disabled={loading || success}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              {error && <div className="modal-error" role="alert">{error}</div>}
              {success && <div className="modal-success" role="status">Joined successfully! ✓</div>}

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
                  disabled={loading || success || !code.trim()}
                >
                  {loading ? (
                    <span className="spinner" style={{ width: 16, height: 16 }} />
                  ) : success ? (
                    'Joined ✓'
                  ) : (
                    'Join Pact'
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
