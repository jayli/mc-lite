# Quickstart: Verifying Block-based Land Caves

## Verification Steps

### 1. Rectangular Cave Rooms
- Dig underground in any land biome (Plains, Forest, etc.).
- Locate hollow areas.
- **Verification**: The caves should form rectangular/boxy "rooms" rather than scattered individual block holes.

### 2. Parameter Control
- In `WorldWorker.js`, adjust `ROOMS_PER_CHUNK` or `MAX_ROOM_SIZE`.
- Refresh the game.
- **Verification**: Higher room count or size should result in significantly more/larger hollow volumes.

### 3. Deep Surface Integrity (Layer 11)
- Dig down to exactly 11 blocks below the terrain surface (`h - 11`).
- **Verification**: This layer must be 100% solid across the entire chunk. No hollows should be visible.

### 4. End Stone Bedrock (Layer 12)
- Dig down to 12 blocks below the surface.
- **Verification**: The entire floor should be `end_stone`.

### 5. Bedrock Invulnerability
- Attempt to mine the `end_stone` at the bottom layer.
- **Verification**: The block should not break.

## Expected Performance
- FPS should remain high (60+) due to the significant reduction in rendered blocks within the rectangular hollows.
