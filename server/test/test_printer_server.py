import importlib.util
import json
import os
from http.client import HTTPConnection
from pathlib import Path
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    "printer_server", Path(__file__).resolve().parents[1] / "printer_server.py"
)
printer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(printer)


class USBDetectionTests(unittest.TestCase):
    def setUp(self):
        self.windows = patch.object(printer.platform, "system", return_value="Windows")
        self.spooler = patch.object(printer, "win32print", Mock())
        self.windows.start()
        self.spooler.start()
        self.addCleanup(self.windows.stop)
        self.addCleanup(self.spooler.stop)

    def native_api(self, device_ids, grow_once=False):
        payload = "\0".join(device_ids) + "\0\0"

        def get_size(size, enumerator, flags):
            self.assertEqual(enumerator, "USB")
            self.assertTrue(flags & printer.CM_GETIDLIST_FILTER_PRESENT)
            size._obj.value = len(payload)
            return printer.CR_SUCCESS

        def get_devices(enumerator, buffer, size, flags):
            if grow_once and api.CM_Get_Device_ID_ListW.call_count == 1:
                return printer.CR_BUFFER_SMALL
            for index, char in enumerate(payload):
                buffer[index] = char
            return printer.CR_SUCCESS

        api = SimpleNamespace(
            CM_Get_Device_ID_List_SizeW=Mock(side_effect=get_size),
            CM_Get_Device_ID_ListW=Mock(side_effect=get_devices),
        )
        return api

    def test_detects_receipt_device_after_an_unrelated_usb_device(self):
        api = self.native_api([
            r"USB\VID_0001&PID_0002\OTHER",
            r"USB\VID_28E9&PID_0289\RECEIPT",
        ])
        with patch.object(printer.ctypes, "WinDLL", return_value=api, create=True):
            self.assertTrue(printer.is_gezhi_usb_connected())

    def test_detects_lowercase_and_composite_device_ids(self):
        for device_id in (
            r"usb\vid_28e9&pid_0289\receipt",
            r"USB\VID_28E9&PID_0289&MI_00\RECEIPT",
        ):
            with self.subTest(device_id=device_id):
                api = self.native_api([device_id])
                with patch.object(printer.ctypes, "WinDLL", return_value=api, create=True):
                    self.assertTrue(printer.is_gezhi_usb_connected())

    def test_missing_or_different_usb_device_is_offline(self):
        for device_ids in ([], [r"USB\VID_28E9&PID_0290\OTHER"]):
            with self.subTest(device_ids=device_ids):
                api = self.native_api(device_ids)
                with patch.object(printer.ctypes, "WinDLL", return_value=api, create=True):
                    self.assertFalse(printer.is_gezhi_usb_connected())

    def test_retries_when_device_list_grows_during_hotplug(self):
        api = self.native_api([r"USB\VID_28E9&PID_0289\RECEIPT"], grow_once=True)
        with patch.object(printer.ctypes, "WinDLL", return_value=api, create=True):
            self.assertTrue(printer.is_gezhi_usb_connected())
        self.assertEqual(api.CM_Get_Device_ID_ListW.call_count, 2)

    def test_native_failure_does_not_claim_printer_is_connected(self):
        api = self.native_api([])
        api.CM_Get_Device_ID_List_SizeW.side_effect = None
        api.CM_Get_Device_ID_List_SizeW.return_value = 13
        with (
            patch.object(printer.ctypes, "WinDLL", return_value=api, create=True),
            patch("builtins.print"),
        ):
            self.assertFalse(printer.is_gezhi_usb_connected())

    def test_non_windows_host_does_not_load_windows_library(self):
        with (
            patch.object(printer.platform, "system", return_value="Linux"),
            patch.object(printer.ctypes, "WinDLL", create=True) as load_library,
        ):
            self.assertFalse(printer.is_gezhi_usb_connected())
        load_library.assert_not_called()


class PrinterSelectionTests(unittest.TestCase):
    def test_prefers_only_gezhi_queue_over_office_default_after_restart(self):
        with (
            patch.object(printer, "selected_printer", None),
            patch.object(printer, "get_default_printer", return_value="Epson Office"),
            patch.object(printer, "get_printers", return_value=[
                {"name": "Epson Office"}, {"name": "GEZHI Test"},
            ]),
        ):
            self.assertEqual(printer.get_selected_printer(), "GEZHI Test")

    def test_keeps_explicit_printer_selection(self):
        with patch.object(printer, "selected_printer", "Selected Receipt Printer"):
            self.assertEqual(printer.get_selected_printer(), "Selected Receipt Printer")


class SilentPrintServer(printer.PrintServer):
    def log_message(self, *args):
        pass


class PrintHTTPTests(unittest.TestCase):
    def setUp(self):
        patches = [
            patch.object(printer, "selected_printer", None),
            patch.object(printer, "get_printer_status", return_value={
                "printer": "GEZHI Test", "online": True, "usbConnected": True,
                "status": 0, "messages": [],
            }),
            patch.object(printer, "get_printers", return_value=[
                {"name": "GEZHI Test", "isDefault": False},
            ]),
            patch.dict(os.environ, {}),
        ]
        for mock_patch in patches:
            mock_patch.start()
            self.addCleanup(mock_patch.stop)
        os.environ.pop("PRINTER_ALLOWED_ORIGINS", None)
        self.server = printer.ThreadingHTTPServer(("127.0.0.1", 0), SilentPrintServer)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, origin, body=None):
        connection = HTTPConnection(*self.server.server_address, timeout=2)
        try:
            headers = {"Origin": origin, "Content-Type": "application/json"}
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_status_is_readable_from_both_local_staff_app_ports(self):
        for origin in (
            "http://localhost:3000", "http://localhost:3001",
            "http://127.0.0.1:3000", "http://127.0.0.1:3001",
        ):
            with self.subTest(origin=origin):
                status, headers, body = self.request("GET", "/status", origin)
                self.assertEqual(status, 200)
                self.assertEqual(headers["Access-Control-Allow-Origin"], origin)
                self.assertEqual(int(headers["Content-Length"]), len(body))
                self.assertEqual(headers["Cache-Control"], "no-store")
                self.assertTrue(json.loads(body)["online"])

    def test_receipt_print_preflight_allows_staff_app_on_port_3001(self):
        status, headers, body = self.request("OPTIONS", "/print", "http://localhost:3001")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:3001")
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])
        self.assertIn("Content-Type", headers["Access-Control-Allow-Headers"])

    def test_unrelated_website_is_not_given_cors_access(self):
        _, headers, _ = self.request("GET", "/status", "https://unrelated.example")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_explicit_origin_configuration_is_respected(self):
        with patch.dict(os.environ, {"PRINTER_ALLOWED_ORIGINS": "https://staff.example"}):
            _, headers, _ = self.request("GET", "/status", "https://staff.example")
            self.assertEqual(headers["Access-Control-Allow-Origin"], "https://staff.example")
            _, headers, _ = self.request("GET", "/status", "http://localhost:3001")
            self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_disconnected_usb_still_blocks_receipt_jobs(self):
        with (
            patch.object(printer, "get_printer_status", return_value={
                "online": False, "messages": ["GEZHI USB printer disconnected"],
            }),
            patch.object(printer, "win32print", Mock()) as spooler,
            patch("builtins.print"),
        ):
            status, _, body = self.request("POST", "/print", "http://localhost:3001", "{}")
            self.assertEqual(status, 500)
            self.assertFalse(json.loads(body)["success"])
            spooler.StartDocPrinter.assert_not_called()


class DisconnectedClientTests(unittest.TestCase):
    def handler(self):
        handler = printer.PrintServer.__new__(printer.PrintServer)
        handler.headers = {}
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler.wfile = Mock()
        handler.close_connection = False
        return handler

    def test_cancelled_clients_do_not_crash_json_responses(self):
        for error in (BrokenPipeError(), ConnectionAbortedError(), ConnectionResetError()):
            with self.subTest(error=type(error).__name__):
                handler = self.handler()
                handler.wfile.write.side_effect = error
                handler.send_json(200, {"success": True})
                self.assertTrue(handler.close_connection)
                handler.wfile.write.assert_called_once()

    def test_cancelled_client_while_sending_headers_is_handled(self):
        handler = self.handler()
        handler.end_headers.side_effect = ConnectionAbortedError()
        handler.send_json(200, {"success": True})
        self.assertTrue(handler.close_connection)
        handler.wfile.write.assert_not_called()

    def test_other_response_errors_are_not_hidden(self):
        handler = self.handler()
        handler.wfile.write.side_effect = OSError("Unexpected failure")
        with self.assertRaisesRegex(OSError, "Unexpected failure"):
            handler.send_json(200, {"success": True})


if __name__ == "__main__":
    unittest.main()
