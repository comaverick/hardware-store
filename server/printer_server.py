import ctypes
import json
import os
import platform
from ctypes import wintypes
try:
    import win32print
except ImportError:
    win32print = None
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime


PORT = int(os.environ.get("PORT", "5100"))

# =========================
# GEZHI USB DEVICE
# =========================

GEZHI_VID = "28E9"
GEZHI_PID = "0289"

CM_GETIDLIST_FILTER_ENUMERATOR = 0x00000001
CM_GETIDLIST_FILTER_PRESENT = 0x00000100
CR_SUCCESS = 0x00000000
CR_BUFFER_SMALL = 0x0000001A

selected_printer = None


# =========================
# PRINTER FUNCTIONS
# =========================

def get_default_printer():
    return win32print.GetDefaultPrinter()


def get_printers():

    if win32print is None:
        return []

    printers = []

    flags = (
        win32print.PRINTER_ENUM_LOCAL
        | win32print.PRINTER_ENUM_CONNECTIONS
    )

    printer_list = win32print.EnumPrinters(
        flags,
        None,
        2
    )

    try:
        default_printer = get_default_printer()
    except Exception:
        default_printer = None

    for printer in printer_list:

        name = printer["pPrinterName"]

        printers.append({
            "name": name,
            "isDefault": name == default_printer,
        })

    return printers


def get_selected_printer():

    global selected_printer

    if selected_printer:
        return selected_printer

    try:
        default_printer = get_default_printer()
    except Exception:
        default_printer = None

    # Receipt printing should not fall back to an unrelated office printer.
    try:
        receipt_printers = [
            printer["name"]
            for printer in get_printers()
            if "gezhi" in printer["name"].casefold()
        ]
        if default_printer in receipt_printers:
            return default_printer
        if len(receipt_printers) == 1:
            return receipt_printers[0]
    except Exception:
        pass

    return default_printer


# =========================
# ACTUAL USB CHECK
# =========================

def is_gezhi_usb_connected():

    if win32print is None or platform.system() != "Windows":
        return False

    try:
        # Query present devices directly. Spawning PowerShell for every poll
        # can time out when status and print requests arrive together.
        cfgmgr32 = ctypes.WinDLL("cfgmgr32")
        get_size = cfgmgr32.CM_Get_Device_ID_List_SizeW
        get_size.argtypes = [
            ctypes.POINTER(wintypes.ULONG), wintypes.LPCWSTR, wintypes.ULONG
        ]
        get_size.restype = wintypes.ULONG
        get_devices = cfgmgr32.CM_Get_Device_ID_ListW
        get_devices.argtypes = [
            wintypes.LPCWSTR, wintypes.LPWSTR, wintypes.ULONG, wintypes.ULONG
        ]
        get_devices.restype = wintypes.ULONG
        flags = CM_GETIDLIST_FILTER_ENUMERATOR | CM_GETIDLIST_FILTER_PRESENT
        prefix = f"USB\\VID_{GEZHI_VID}&PID_{GEZHI_PID}".upper()

        # A device can be plugged in between the size and list queries.
        for _ in range(3):
            size = wintypes.ULONG()
            result = get_size(ctypes.byref(size), "USB", flags)
            if result != CR_SUCCESS:
                raise OSError(f"Windows USB detection failed (code {result})")
            if size.value == 0:
                return False
            buffer = ctypes.create_unicode_buffer(size.value)
            result = get_devices("USB", buffer, size.value, flags)
            if result == CR_BUFFER_SMALL:
                continue
            if result != CR_SUCCESS:
                raise OSError(f"Windows USB detection failed (code {result})")
            return any(
                device.upper().startswith((prefix + "\\", prefix + "&"))
                for device in buffer[:].split("\0")
            )

        raise OSError("Windows USB device list kept changing; try again")

    except Exception as error:

        print(
            "USB CHECK ERROR:",
            error
        )

        return False


# =========================
# PRINTER QUEUE CHECK
# =========================

def check_windows_printer(printer_name):

    try:

        printer = win32print.OpenPrinter(
            printer_name
        )

        try:

            info = win32print.GetPrinter(
                printer,
                2
            )

            status = info.get(
                "Status",
                0
            )

            return {
                "available": True,
                "status": status
            }

        finally:

            win32print.ClosePrinter(
                printer
            )

    except Exception as error:

        return {
            "available": False,
            "status": None,
            "error": str(error)
        }


# =========================
# COMPLETE PRINTER STATUS
# =========================

def get_printer_status():

    printer_name = get_selected_printer()

    # First check the physical USB device.
    usb_connected = (
        is_gezhi_usb_connected()
    )

    if not usb_connected:

        return {
            "online": False,

            "usbConnected": False,

            "printer": printer_name,

            "status": None,

            "messages": [
                "GEZHI USB printing is only available on the Windows computer connected to the printer" if win32print is None else "GEZHI USB printer disconnected"
            ]
        }

    # USB exists, now check Windows printer.
    if not printer_name:

        return {
            "online": False,

            "usbConnected": True,

            "printer": None,

            "status": None,

            "messages": [
                "USB printer detected but no Windows printer selected"
            ]
        }

    windows_status = (
        check_windows_printer(
            printer_name
        )
    )

    if not windows_status["available"]:

        return {
            "online": False,

            "usbConnected": True,

            "printer": printer_name,

            "status": None,

            "messages": [
                "Printer queue unavailable"
            ]
        }

    return {
        "online": True,

        "usbConnected": True,

        "printer": printer_name,

        "status":
            windows_status["status"],

        "messages": []
    }


# =========================
# RECEIPT FORMAT
# =========================

def format_money(value):

    return f"P{float(value):,.2f}"


def receipt_text(value, fallback, max_length, multiline=False):
    if not isinstance(value, str):
        return fallback
    text = "".join(
        char if (ord(char) >= 32 and ord(char) != 127) or (multiline and char == "\n") else " "
        for char in value
    ).strip()[:max_length]
    return text or fallback


def format_receipt(data):

    lines = []

    RESET = b"\x1b\x40"

    CENTER = b"\x1b\x61\x01"
    LEFT = b"\x1b\x61\x00"

    BOLD_ON = b"\x1b\x45\x01"
    BOLD_OFF = b"\x1b\x45\x00"

    lines.append(RESET)

    # =========================
    # HEADER
    # =========================

    lines.append(CENTER)
    lines.append(BOLD_ON)

    lines.append(
        (receipt_text(data.get("storeName"), "HARDWARE STORE", 80) + "\n").encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(BOLD_OFF)

    branch = data.get(
        "branch",
        "Hardware Store"
    )

    lines.append(
        f"{branch}\n"
        "Official Sales Receipt\n"
        .encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(
        b"--------------------------------\n"
    )

    # =========================
    # INFORMATION
    # =========================

    lines.append(LEFT)

    receipt_number = data.get(
        "receiptNumber",
        "N/A"
    )

    date = data.get(
        "date",
        datetime.now().strftime(
            "%Y-%m-%d %H:%M"
        )
    )

    cashier = data.get(
        "cashier",
        "Cashier"
    )

    lines.append(
        f"Receipt: {receipt_number}\n"
        .encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(
        f"Date: {date}\n"
        .encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(
        f"Cashier: {cashier}\n"
        .encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(
        b"--------------------------------\n"
    )

    # =========================
    # ITEMS
    # =========================

    for item in data.get(
        "items",
        []
    ):

        name = str(
            item.get(
                "name",
                "Item"
            )
        )

        quantity = int(
            item.get(
                "quantity",
                0
            )
        )

        price = float(
            item.get(
                "price",
                0
            )
        )

        total = quantity * price

        name = name[:20]

        lines.append(
            (
                f"{name:<20}"
                f"{format_money(total):>11}\n"
            ).encode(
                "cp437",
                errors="replace"
            )
        )

        lines.append(
            (
                f"  {quantity} x "
                f"{format_money(price)}\n"
            ).encode(
                "cp437",
                errors="replace"
            )
        )

    # =========================
    # TOTALS
    # =========================

    lines.append(
        b"--------------------------------\n"
    )

    subtotal = float(
        data.get(
            "subtotal",
            0
        )
    )

    discount = float(
        data.get(
            "discount",
            0
        )
    )

    total = float(
        data.get(
            "total",
            0
        )
    )

    amount_paid = float(
        data.get(
            "amountPaid",
            0
        )
    )

    change = float(
        data.get(
            "change",
            0
        )
    )

    lines.append(BOLD_ON)

    lines.append(
        (
            f"SUBTOTAL: "
            f"{format_money(subtotal):>19}\n"
        ).encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(BOLD_OFF)

    lines.append(
        (
            f"DISCOUNT: "
            f"{format_money(discount):>19}\n"
        ).encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(BOLD_ON)

    lines.append(
        (
            f"TOTAL:    "
            f"{format_money(total):>19}\n"
        ).encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(BOLD_OFF)

    # =========================
    # PAYMENT
    # =========================

    payment_method = data.get(
        "paymentMethod",
        "CASH"
    )

    lines.append(b"\n")

    lines.append(
        f"PAYMENT: {payment_method}\n"
        .encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(
        (
            f"PAID:    "
            f"{format_money(amount_paid):>19}\n"
        ).encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(
        (
            f"CHANGE:  "
            f"{format_money(change):>19}\n"
        ).encode(
            "cp437",
            errors="replace"
        )
    )

    lines.append(
        b"--------------------------------\n"
    )

    # =========================
    # FOOTER
    # =========================

    lines.append(CENTER)

    lines.append(BOLD_ON)

    footer = receipt_text(data.get("receiptFooter"), "THANK YOU!\nPlease come again.", 200, multiline=True)
    footer_lines = footer.split("\n", 1)
    lines.append(
        (footer_lines[0] + "\n").encode("cp437", errors="replace")
    )

    lines.append(BOLD_OFF)

    if len(footer_lines) > 1:
        lines.append((footer_lines[1] + "\n").encode("cp437", errors="replace"))

    lines.append(
        b"\n\n\n"
    )

    # Cut paper
    lines.append(
        b"\x1d\x56\x00"
    )

    return b"".join(lines)


# =========================
# HTTP SERVER
# =========================

class PrintServer(
    BaseHTTPRequestHandler
):

    def _headers(self):

        origin = self.headers.get("Origin")
        allowed_origins = {
            value.strip()
            for value in os.environ.get(
                "PRINTER_ALLOWED_ORIGINS",
                "https://hardware-store-rho.vercel.app,"
                "http://localhost:3000,http://localhost:3001,"
                "http://127.0.0.1:3000,http://127.0.0.1:3001"
            ).split(",")
            if value.strip()
        }

        if origin and origin in allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
        elif not origin:
            self.send_header("Access-Control-Allow-Origin", "*")

        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
    def send_json(
        self,
        status,
        data
    ):

        body = json.dumps(data).encode("utf-8")
        try:
            self.send_response(status)
            self._headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # A browser may cancel a request while navigating or timing out.
            # The disconnected client must not turn a completed print into
            # a print error or trigger another attempt to write a response.
            self.close_connection = True

    # =========================
    # GET
    # =========================

    def do_GET(self):

        # =========================
        # PRINTERS
        # =========================

        if self.path == "/printers":

            try:

                printers = get_printers()

                try:
                    default_printer = (
                        get_default_printer()
                    )
                except Exception:
                    default_printer = None

                current_printer = (
                    get_selected_printer()
                )

                self.send_json(
                    200,
                    {
                        "success": True,

                        "printers":
                            printers,

                        "selectedPrinter":
                            current_printer,

                        "defaultPrinter":
                            default_printer
                    }
                )

            except Exception as error:

                self.send_json(
                    500,
                    {
                        "success": False,
                        "error":
                            str(error)
                    }
                )

            return

        # =========================
        # STATUS
        # =========================

        if self.path == "/status":

            result = (
                get_printer_status()
            )

            self.send_json(
                200,
                {
                    "success": True,

                    "printer":
                        result["printer"],

                    "online":
                        result["online"],

                    "usbConnected":
                        result["usbConnected"],

                    "status":
                        result["status"],

                    "messages":
                        result["messages"]
                }
            )

            return

        self.send_json(
            404,
            {
                "success": False,
                "message":
                    "Not found"
            }
        )

    # =========================
    # OPTIONS
    # =========================

    def do_OPTIONS(self):

        self.send_response(200)

        self._headers()

        self.end_headers()

    # =========================
    # POST
    # =========================

    def do_POST(self):

        global selected_printer

        # =========================
        # SELECT PRINTER
        # =========================

        if self.path == "/printer/select":

            try:

                content_length = int(
                    self.headers[
                        "Content-Length"
                    ]
                )

                body = self.rfile.read(
                    content_length
                )

                data = json.loads(
                    body.decode("utf-8")
                )

                printer_name = data.get(
                    "printer"
                )

                if not printer_name:

                    self.send_json(
                        400,
                        {
                            "success": False,

                            "message":
                                "Printer name is required."
                        }
                    )

                    return

                printers = get_printers()

                names = [
                    printer["name"]
                    for printer in printers
                ]

                if printer_name not in names:

                    self.send_json(
                        404,
                        {
                            "success": False,

                            "message":
                                "Printer not found."
                        }
                    )

                    return

                selected_printer = (
                    printer_name
                )

                result = (
                    get_printer_status()
                )

                self.send_json(
                    200,
                    {
                        "success": True,

                        "printer":
                            selected_printer,

                        "online":
                            result["online"],

                        "usbConnected":
                            result["usbConnected"],

                        "status":
                            result["status"],

                        "messages":
                            result["messages"]
                    }
                )

            except Exception as error:

                self.send_json(
                    500,
                    {
                        "success": False,

                        "error":
                            str(error)
                    }
                )

            return

        # =========================
        # PRINT
        # =========================

        if self.path != "/print":

            self.send_json(
                404,
                {
                    "success": False,

                    "message":
                        "Not found"
                }
            )

            return

        try:

            content_length = int(
                self.headers[
                    "Content-Length"
                ]
            )

            body = self.rfile.read(
                content_length
            )

            data = json.loads(
                body.decode("utf-8")
            )

            # =========================
            # CHECK PHYSICAL USB FIRST
            # =========================

            printer_status = (
                get_printer_status()
            )

            if not printer_status[
                "online"
            ]:

                raise Exception(
                    "Printer is offline: "
                    +
                    (
                        ", ".join(
                            printer_status[
                                "messages"
                            ]
                        )
                        or
                        "GEZHI USB printer is disconnected."
                    )
                )

            printer_name = (
                printer_status[
                    "printer"
                ]
            )

            receipt_data = (
                format_receipt(
                    data
                )
            )

            printer = (
                win32print.OpenPrinter(
                    printer_name
                )
            )

            try:

                win32print.StartDocPrinter(
                    printer,
                    1,
                    (
                        "Hardware Store Receipt",
                        None,
                        "RAW"
                    )
                )

                win32print.StartPagePrinter(
                    printer
                )

                win32print.WritePrinter(
                    printer,
                    receipt_data
                )

                win32print.EndPagePrinter(
                    printer
                )

                win32print.EndDocPrinter(
                    printer
                )

            finally:

                win32print.ClosePrinter(
                    printer
                )

            self.send_json(
                200,
                {
                    "success": True,

                    "message":
                        "Receipt sent to printer",

                    "printer":
                        printer_name
                }
            )

            print(
                "Receipt sent to printer."
            )

        except Exception as error:

            print(
                "PRINT ERROR:",
                error
            )

            self.send_json(
                500,
                {
                    "success": False,

                    "error":
                        str(error)
                }
            )


# =========================
# START SERVER
# =========================

if __name__ == "__main__":
    server = ThreadingHTTPServer(
        (os.environ.get("HOST", "0.0.0.0"), PORT),
        PrintServer
    )

    print("--------------------------------")
    print("HARDWARE STORE PRINT SERVER")
    print("--------------------------------")
    print(f"Server listening on {os.environ.get('HOST', '0.0.0.0')}:{PORT}")
    print("GEZHI USB VID: 28E9")
    print("GEZHI USB PID: 0289")
    print(f"Physical USB detection: {'ENABLED' if win32print else 'UNAVAILABLE (non-Windows host)'}")
    print("Waiting for print requests...")
    print("--------------------------------")

    server.serve_forever()

