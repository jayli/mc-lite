# Quickstart: Minigun Testing

## Test Scenario 1: Weapon Rotation
1. 启动游戏 (`npm start`)。
2. 进入游戏世界。
3. 按下 `R` 键。
4. **预期**: 武器在 徒手 -> 手枪 -> Mag7 -> Minigun 之间循环。
5. **验证**: 每次切换到 Minigun 时，应听到上膛音效，并看到模型从屏幕下方平滑升起。

## Test Scenario 2: Rapid Fire
1. 切换到 Minigun。
2. 找到一堵墙或一群方块。
3. 按住鼠标左键。
4. **预期**:
   - 产生密集的示踪线。
   - 听到持续的高频射击声。
   - 方块被快速挖掘/破坏。
   - 武器模型有轻微的后坐力抖动。

## Test Scenario 3: Interruption
1. 按住左键保持 Minigun 射击。
2. 在射击过程中按下 `R` 键。
3. **预期**:
   - 射击立即停止。
   - 武器切换到徒手（或其他模式）。
   - 射击音效停止。
