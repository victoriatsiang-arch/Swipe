'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pdfjs } from 'react-pdf'
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

interface PDFViewerProps {
  file?: File | Blob | string | null
  scrollable?: boolean
  pageNumber?: number
  onDocumentLoad?: (numPages: number) => void
}

const PDFViewer: React.FC<PDFViewerProps> = ({
  file,
  scrollable = false,
  pageNumber = 1,
  onDocumentLoad,
}) => {
  const [scale, setScale] = useState<number>(1.0)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [pageDimensions, setPageDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [containerSize, setContainerSize] = useState({
    width: 0,
    height: 0,
  })
  const [pdfInstance, setPdfInstance] = useState<PDFDocumentProxy | null>(null)
  const [imageCache, setImageCache] = useState<Record<number, string>>({})
  const [displayedPage, setDisplayedPage] = useState(
    Math.max(1, pageNumber ?? 1)
  )
  const [isRendering, setIsRendering] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const pdfTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const loadingPagesRef = useRef<Set<number>>(new Set())
  const sizeSignatureRef = useRef<string>('')

  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const updateSize = () => {
      setContainerSize({
        width: node.clientWidth,
        height: node.clientHeight,
      })
    }

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(node)
    updateSize()

    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!file) {
      setPdfInstance(null)
      setImageCache({})
      setDisplayedPage(1)
      return
    }

    let cancelled = false
    const loadPdf = async () => {
      try {
        let source: Parameters<typeof pdfjs.getDocument>[0]
        if (typeof file === 'string') {
          source = file
        } else if (file instanceof Blob) {
          const buffer = await file.arrayBuffer()
          source = { data: buffer }
        } else {
          source = file as never
        }
        const loadingTask = pdfjs.getDocument(source)
        pdfTaskRef.current = loadingTask
        const doc = await loadingTask.promise
        if (!cancelled) {
          setPdfInstance(doc)
          onDocumentLoad?.(doc.numPages)
          setImageCache({})
          setDisplayedPage(Math.max(1, pageNumber ?? 1))
        }
      } catch (err) {
        console.error('Failed to load PDF', err)
      }
    }

    loadPdf()

    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      pdfTaskRef.current?.destroy()
    }
  }, [file, onDocumentLoad])

  const effectiveWidthLimit =
    containerSize.width > 0 ? containerSize.width : 1000
  const effectiveHeightLimit =
    containerSize.height > 0 ? containerSize.height : 600

  const targetViewport = useMemo(() => {
    if (!pageDimensions) {
      return { width: effectiveWidthLimit, height: effectiveHeightLimit }
    }
    const widthScale = effectiveWidthLimit / pageDimensions.width
    const heightScale = effectiveHeightLimit / pageDimensions.height
    const fitScale = Math.min(widthScale, heightScale)
    return {
      width: pageDimensions.width * fitScale,
      height: pageDimensions.height * fitScale,
      scale: fitScale,
    }
  }, [pageDimensions, effectiveWidthLimit, effectiveHeightLimit])

  const ensurePageImage = useCallback(
    async (
      pageNum: number,
      options: { setActive?: boolean; force?: boolean } = {}
    ) => {
      const { setActive = false, force = false } = options
      if (
        !pdfInstance ||
        !containerSize.width ||
        !containerSize.height ||
        pageNum < 1 ||
        pageNum > pdfInstance.numPages
      ) {
        return
      }
      if (!force && imageCache[pageNum]) {
        if (setActive) {
          setDisplayedPage(pageNum)
          setIsRendering(false)
        }
        return
      }
      if (loadingPagesRef.current.has(pageNum)) {
        return
      }
      loadingPagesRef.current.add(pageNum)
      if (setActive) {
        setIsRendering(true)
      }
      try {
        const page = await pdfInstance.getPage(pageNum)
        setPageDimensions({
          width: page.view[2],
          height: page.view[3],
        })
        const widthScale = containerSize.width / page.view[2]
        const heightScale = containerSize.height / page.view[3]
        const scaleValue = Math.min(widthScale, heightScale) || 1
        const viewport = page.getViewport({ scale: scaleValue })
        const canvas = document.createElement('canvas')
        const pixelRatio = window.devicePixelRatio || 1
        const ctx = canvas.getContext('2d', { alpha: false })
        canvas.width = viewport.width * pixelRatio
        canvas.height = viewport.height * pixelRatio
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        ctx?.scale(pixelRatio, pixelRatio)
        const renderTask = page.render({
          canvasContext: ctx as CanvasRenderingContext2D,
          viewport,
          canvas,
        })
        renderTaskRef.current = renderTask
        await renderTask.promise
        const dataUrl = canvas.toDataURL('image/png', 0.92)
        setImageCache((prev) => ({ ...prev, [pageNum]: dataUrl }))
        if (setActive) {
          setDisplayedPage(pageNum)
          setIsRendering(false)
        }
      } catch (err) {
        console.warn('Failed to render page', err)
        if (setActive) {
          setIsRendering(false)
        }
      } finally {
        loadingPagesRef.current.delete(pageNum)
      }
    },
    [containerSize.height, containerSize.width, imageCache, pdfInstance]
  )

  useEffect(() => {
    if (!pdfInstance) {
      return
    }
    const target = Math.max(1, pageNumber ?? 1)
    if (imageCache[target]) {
      setDisplayedPage(target)
      setIsRendering(false)
    } else {
      ensurePageImage(target, { setActive: true })
    }
  }, [ensurePageImage, imageCache, pageNumber, pdfInstance])

  useEffect(() => {
    if (!pdfInstance) {
      return
    }
    const next = Math.max(1, (pageNumber ?? 1) + 1)
    if (next <= pdfInstance.numPages) {
      ensurePageImage(next)
    }
  }, [ensurePageImage, pageNumber, pdfInstance])

  useEffect(() => {
    if (!containerSize.width || !containerSize.height) {
      return
    }
    const signature = `${Math.round(containerSize.width)}x${Math.round(
      containerSize.height
    )}`
    if (sizeSignatureRef.current !== signature) {
      sizeSignatureRef.current = signature
      setImageCache({})
      if (pdfInstance) {
        ensurePageImage(Math.max(1, pageNumber ?? 1), {
          setActive: true,
          force: true,
        })
      }
    }
  }, [
    containerSize.height,
    containerSize.width,
    ensurePageImage,
    pageNumber,
    pdfInstance,
  ])

  if (!file) {
    return (
      <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
        Upload a PDF to preview it here.
      </div>
    )
  }

  const activeImage = imageCache[displayedPage]

  return (
    <div
      ref={containerRef}
      className={`w-full h-full flex items-center justify-center ${
        scrollable ? 'overflow-auto' : 'overflow-hidden'
      }`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
      }}
    >
      {activeImage ? (
        <img
          src={activeImage}
          alt={`Slide ${displayedPage}`}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
          style={{
            width: targetViewport.width || '100%',
            height: 'auto',
            transition: 'opacity 120ms ease-out',
            opacity: isRendering ? 0.3 : 1,
          }}
        />
      ) : (
        <div className="text-sm text-muted-foreground">Preparing slide...</div>
      )}
    </div>
  )
}

export default PDFViewer
