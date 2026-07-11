package expo.modules.t3terminal

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TerminalHardwareKeyEncoderTest {
  @Test
  fun `encodes terminal navigation keys`() {
    assertSequence("\u001B", KeyEvent.KEYCODE_ESCAPE)
    assertSequence("\t", KeyEvent.KEYCODE_TAB)
    assertSequence("\u001B[Z", KeyEvent.KEYCODE_TAB, isShiftPressed = true)
    assertSequence("\u001B[A", KeyEvent.KEYCODE_DPAD_UP)
    assertSequence("\u001B[B", KeyEvent.KEYCODE_DPAD_DOWN)
    assertSequence("\u001B[C", KeyEvent.KEYCODE_DPAD_RIGHT)
    assertSequence("\u001B[D", KeyEvent.KEYCODE_DPAD_LEFT)
  }

  @Test
  fun `encodes control keys`() {
    assertSequence("\u0001", KeyEvent.KEYCODE_A, isCtrlPressed = true)
    assertSequence("\u001A", KeyEvent.KEYCODE_Z, isCtrlPressed = true)
    assertSequence("\u001B", KeyEvent.KEYCODE_LEFT_BRACKET, isCtrlPressed = true)
    assertSequence(
      "\u007F",
      KeyEvent.KEYCODE_SLASH,
      isCtrlPressed = true,
      isShiftPressed = true,
    )
  }

  @Test
  fun `does not consume unhandled keys`() {
    assertNull(TerminalHardwareKeyEncoder.sequence(KeyEvent.KEYCODE_A, false, false))
    assertNull(TerminalHardwareKeyEncoder.sequence(KeyEvent.KEYCODE_SLASH, true, false))
  }

  private fun assertSequence(
    expected: String,
    keyCode: Int,
    isCtrlPressed: Boolean = false,
    isShiftPressed: Boolean = false
  ) {
    assertEquals(
      expected,
      TerminalHardwareKeyEncoder.sequence(keyCode, isCtrlPressed, isShiftPressed),
    )
  }
}
