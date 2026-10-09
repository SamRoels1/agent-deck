// Shared drawing helpers: a box with a fold arrow in its header.
import type { EngineInterface, RenderElement } from 'claude-code'

import { PALETTES } from './core'

export type Els = ReturnType<EngineInterface['ui']['resolve']>
export type Colors = (typeof PALETTES)[keyof typeof PALETTES]

export type PanelOpts = {
  /** Stable id of the box; what `folded` stores. */
  id: string
  title: string
  /** A theme key or colour for the border. */
  color: string
  /** Short text on the right of the header, still readable when the box is folded. */
  summary?: string
  isOpen: boolean
  onToggle: () => void
  width: number
}

/** A rounded box whose header row carries the ▾/▸ fold button. A folded box is its header alone. */
export const panel = (els: Els, o: PanelOpts, body: RenderElement | RenderElement[] | null) => {
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={o.color} paddingX={1} width={o.width}>
      <Box justifyContent="space-between">
        <Button key={`fold-${o.id}`} plain label={`${o.isOpen ? '▾' : '▸'} ${o.title}`} onPress={o.onToggle} />
        <Text dimColor wrap="truncate">{o.summary ?? ''}</Text>
      </Box>
      {o.isOpen ? body : null}
    </Box>
  )
}
