// Finds the pictures tools returned to Claude (Read, browser and screen
// screenshots, any MCP tool) in a conversation's rows.

import type { Shot } from '../types'

import { base64ToBytes, sizeOf } from './picture'

type Block = { type: string; [field: string]: unknown }
export type ToolUse = { name: string; input: unknown }
// A picture found, with its bytes and the call that returned it.
export type Found = { shot: Shot; data: string; callId: string }

// FNV-1a over the whole base64 text and its length: the same bytes, the same id.
export function hashOf(data: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + data.length.toString(36)
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

// What stands for a picture a tool returned where it cannot be drawn.
export function labelOf(tool: string, input: unknown): string {
  const rec = (input ?? {}) as Record<string, unknown>
  if (tool === 'Read' && typeof rec.file_path === 'string') return baseName(rec.file_path)
  if (tool.startsWith('mcp__')) {
    const [, server = '', name = ''] = tool.split('__')
    if (/chrome/i.test(server)) return 'Chrome 截图'
    if (/browser/i.test(server)) return '浏览器截图'
    if (/computer/i.test(server) || /^computer/i.test(name)) return '屏幕截图'
    return `${server} · ${name}`
  }
  return tool
}

function imageOf(block: Block): { mime: string; data: string } | undefined {
  if (block?.type !== 'image') return undefined
  const source = block.source as { type?: string; media_type?: string; data?: string } | undefined
  if (source?.type !== 'base64' || typeof source.data !== 'string' || typeof source.media_type !== 'string') return undefined
  return { mime: source.media_type, data: source.data }
}

// Notes the tool calls an assistant row makes, so their results can be labelled.
export function noteCalls(content: readonly unknown[], calls: Map<string, ToolUse>): void {
  for (const b of content as Block[]) {
    if (b?.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      calls.set(b.id, { name: b.name, input: b.input })
    }
  }
}

// The pictures in the tool results of one user-side row.
export function picturesOf(content: readonly unknown[], calls: Map<string, ToolUse>, tool?: string): Found[] {
  const out: Found[] = []
  for (const b of content as Block[]) {
    if (b?.type !== 'tool_result' || !Array.isArray(b.content) || typeof b.tool_use_id !== 'string') continue
    const call = calls.get(b.tool_use_id)
    const label = labelOf(call?.name ?? tool ?? '工具', call?.input)
    for (const image of (b.content as Block[]).map(imageOf)) {
      if (image === undefined) continue
      let size: { width: number; height: number } | undefined
      try {
        // The header is near the start; a JPEG with a large EXIF block needs it all.
        size = sizeOf(image.mime, base64ToBytes(image.data.slice(0, 64 * 1024))) ?? sizeOf(image.mime, base64ToBytes(image.data))
      } catch {
        size = undefined
      }
      out.push({
        shot: { id: hashOf(image.data), mime: image.mime, width: size?.width ?? 0, height: size?.height ?? 0, label },
        data: image.data,
        callId: b.tool_use_id,
      })
    }
  }
  return out
}
