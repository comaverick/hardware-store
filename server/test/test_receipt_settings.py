import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("printer_server", Path(__file__).resolve().parents[1] / "printer_server.py")
printer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(printer)


class ReceiptPreferencesTests(unittest.TestCase):
    def test_existing_receipts_keep_the_default_header_and_footer(self):
        receipt = printer.format_receipt({})
        self.assertIn(b"HARDWARE STORE\n", receipt)
        self.assertIn(b"THANK YOU!\n", receipt)
        self.assertIn(b"Please come again.\n", receipt)
        self.assertTrue(receipt.endswith(b"\x1d\x56\x00"))

    def test_preferences_are_printed_without_changing_sale_totals(self):
        receipt = printer.format_receipt({
            "storeName": "Builder Supply", "receiptFooter": "Thanks for shopping locally!\nCome again.",
            "total": 100, "amountPaid": 150, "change": 50,
        })
        self.assertIn(b"Builder Supply\n", receipt)
        self.assertIn(b"Thanks for shopping locally!\n", receipt)
        self.assertIn(b"Come again.\n", receipt)
        self.assertIn(b"100.00", receipt)
        self.assertIn(b"50.00", receipt)

    def test_receipt_text_cannot_inject_printer_commands(self):
        receipt = printer.format_receipt({"storeName": "Store\x1b\x40", "receiptFooter": "Thanks\x1d\x56\x00"})
        self.assertEqual(receipt.count(b"\x1b\x40"), 1)
        self.assertEqual(receipt.count(b"\x1d\x56\x00"), 1)

    def test_invalid_or_oversized_preferences_have_safe_defaults_and_limits(self):
        self.assertEqual(printer.receipt_text(None, "Store", 80), "Store")
        self.assertEqual(printer.receipt_text("\x00", "Store", 80), "Store")
        self.assertEqual(len(printer.receipt_text("A" * 100, "Store", 80)), 80)


if __name__ == "__main__":
    unittest.main()
