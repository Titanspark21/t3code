package expo.modules.t3terminal

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TerminalFrameTest {
  @Test
  fun `visibleText exposes rows while trimming trailing empty cells`() {
    val frame = TerminalFrame(
      cols = 4,
      rows = 2,
      cursorX = 1,
      cursorY = 0,
      cursorVisible = true,
      cursorStyle = 0,
      cursorBlinking = true,
      foreground = 0,
      background = 0,
      cursorColor = 0,
      cellForegrounds = IntArray(8),
      cellBackgrounds = IntArray(8),
      cellFlags = IntArray(8),
      cellText = arrayOf("p", "w", "d", "", "$", " ", "", ""),
    )

    assertEquals("pwd\n$", frame.visibleText())
  }

  @Test
  fun `decode rejects dimensions whose cell count exceeds Int range`() {
    val bytes = ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN).apply {
      putInt(0x54563354)
      putShort(1)
      putShort(0xFFFF.toShort())
      putShort(0xFFFF.toShort())
      putShort(0)
      putShort(0)
      put(0)
      put(0)
      put(0)
      put(0)
      putInt(0)
      putInt(0)
      putInt(0)
    }.array()

    assertNull(TerminalFrame.decode(bytes))
  }
}
