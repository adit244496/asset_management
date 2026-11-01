from app import roles

SA, AD, VR, VW = roles.SUPERADMIN, roles.ADMIN, roles.VERIFIER, roles.VIEWER
EVERYONE = (SA, AD, VR, VW)
WRITERS = (SA, AD)
EDITORS = tuple(r for r in roles.ALL_ROLES if r in roles.EDIT_ROLES)
VERIFIERS = tuple(r for r in roles.ALL_ROLES if r in roles.VERIFY_ROLES)

GUIDE = [
    {
        "id": "find-asset",
        "title": "Find a device or licence from its label or serial number",
        "roles": EVERYONE,
        "route": "/find",
        "keywords": "search scan qr barcode serial lookup find sap id service tag software licence license key",
        "steps": [
            "Click the magnifier icon at the top right, or go to Find an Asset.",
            "Scan the QR label with a reader or this device's camera, or type the serial "
            "number, Asset ID, SAP ID, service tag or computer name.",
            "Every register is searched, so you do not need to know whether it is an "
            "asset, a peripheral or a software licence. A licence is found by its Software "
            "ID (SFT...) or its Serial Number (the licence key).",
        ],
    },
    {
        "id": "software-overview",
        "title": "Find your way around the Softwares register",
        "roles": EVERYONE,
        "route": "/report",
        "keywords": "software softwares licence license subscription seats register overview dashboard fields vendor",
        "steps": [
            "Softwares is the third register, beside Assets and Peripherals. Choose Softwares "
            "with the switch at the top right of Dashboard, Report, History or Data Entry.",
            "A software record holds only: Software Name, Version, Status, Serial Number, "
            "Quantity (how many seats), PO Number, Renewal Date, Price (for the whole record), "
            "Vendor / Used By (the vendor, or the person using it) and Comment. It has no "
            "location, department or company.",
            "Its Software ID (SFT...) is shown under the name in Report.",
            "The Dashboard for Softwares shows the licences and seats, how many are in use and "
            "in stock, renewals overdue, total licence value and vendors, with a Vendor / Used By filter.",
            "Spare licences (IN STOCK) are listed in Inventory under SOFTWARE.",
        ],
    },
    {
        "id": "software-renewals-check",
        "title": "See which software licences are due for renewal",
        "roles": EVERYONE,
        "route": "/report",
        "keywords": "software renewal due overdue expiry expire expiring licence license subscription date",
        "steps": [
            "Open Report and choose Softwares. In the Renewal Date column, a date that has "
            "passed is tagged Overdue, and one within 30 days shows how many days are left.",
            "Click the Renewal Date heading to sort by it, or use Advance Filter for a date range.",
            "The Softwares Dashboard shows Renewal Overdue, how many are due in the next 30 "
            "days, and a chart of renewals by year.",
            "You can also ask the assistant, for example: which licences renew next month?",
        ],
    },
    {
        "id": "report-filter",
        "title": "Search, filter and sort the register",
        "roles": EVERYONE,
        "route": "/report",
        "keywords": "report grid filter sort search column list software licence",
        "steps": [
            "Open Report in the top bar and choose Assets, Peripherals or Softwares.",
            "Type in the search box to search every column at once.",
            "Use Advance Filter for per-column filters.",
            "Click a column heading to sort: once for ascending, twice for descending, "
            "a third time to return to the normal order.",
        ],
    },
    {
        "id": "export",
        "title": "Export the register to CSV or Excel",
        "roles": EVERYONE,
        "route": "/report",
        "keywords": "export download csv excel xlsx spreadsheet software licence",
        "steps": [
            "Open Report, choose Assets, Peripherals or Softwares, and apply any filters you "
            "want -- the export follows what is on screen.",
            "Use the export button above the grid and choose CSV or Excel.",
            "A Softwares export has the software's own columns: name, version, status, serial "
            "number, quantity, PO number, renewal date, price, vendor / used by and comment.",
        ],
    },
    {
        "id": "inventory",
        "title": "See what is in stock",
        "roles": EVERYONE,
        "route": "/inventory",
        "keywords": "stock spare inventory available unassigned",
        "steps": [
            "Open Inventory in the top bar.",
            "It lists every record whose status is IN STOCK, across all three registers "
            "(spare software licences count as SOFTWARE), with counts by type. Click a type "
            "to narrow the list.",
        ],
    },
    {
        "id": "history",
        "title": "See who had a device or licence and what changed",
        "roles": EVERYONE,
        "route": "/history",
        "keywords": "history audit trail changes previous owner who had software licence seats "
                    "download report excel most changed frequently changed",
        "steps": [
            "Open History, choose the register at the top right (Assets, Peripherals or "
            "Softwares), and search for the record -- or open the record and use its History button.",
            "Every change is listed newest first: who made it, what it was before, and "
            "what it became. Download PDF gives a printable copy.",
            "The Changes filter keeps only records changed at least that many times, e.g. 4 or more.",
            "Download report saves the movement history as Excel: one row per change -- what changed, "
            "from what, to what, when and by whom -- with the record's ID, name and status on every "
            "row, plus a Summary sheet with each record's count. Tick one or more records first to "
            "get only theirs (their full history); with nothing ticked it covers every record the "
            "list shows, on all pages, with the same filters.",
            "For a software, seats assigned or returned to stock show there too, including "
            "a record split off from another one.",
        ],
    },
    {
        "id": "qr-labels",
        "title": "Print QR labels",
        "roles": EVERYONE,
        "route": "/report",
        "keywords": "qr label print sticker tag software licence",
        "steps": [
            "In Report, tick the records you want labels for -- assets, peripherals or softwares.",
            "Choose QR labels in the bar that appears, check each label, then print.",
        ],
    },
    {
        "id": "add-record",
        "title": "Add a new asset or peripheral",
        "roles": WRITERS,
        "route": "/data-entry",
        "keywords": "add new create register entry form",
        "steps": [
            "Open Data Entry and choose Assets or Peripherals at the top right (Softwares "
            "has its own, shorter form -- see Add a software licence).",
            "Fill in the form -- fields marked * are required. The Asset ID is assigned "
            "automatically when you save.",
            "Choosing the Assigned User fills in their email and location for you.",
            "The new record then waits in Verification. It appears in Report, Inventory and "
            "the Dashboard only once someone has verified it.",
            "A record entered with a SAP ID skips Verification and goes straight into the "
            "register -- it is already booked in SAP.",
        ],
    },
    {
        "id": "add-software",
        "title": "Add a software licence",
        "roles": WRITERS,
        "route": "/data-entry",
        "keywords": "software licence license subscription add new seats renewal key version",
        "steps": [
            "Open Data Entry and choose Softwares at the top right.",
            "Fill in Software Name and Status (both required), and whichever of Version, "
            "Serial Number, Quantity (seats), PO Number, Renewal Date, Price and Vendor / "
            "Used By you have. The Software ID (SFT...) is assigned when you save.",
            "Many licences at once: use Bulk Upload on the same page with the Softwares "
            "template.",
            "Like any new entry, it waits in Verification until someone else verifies it.",
        ],
    },
    {
        "id": "move-software",
        "title": "Assign software seats, or move them back to stock",
        "roles": WRITERS,
        "route": "/report",
        "keywords": "software assign seats licence license stock return give allocate move quantity",
        "steps": [
            "Open Report, choose Softwares, and use the icon on the row -- Assign from stock "
            "for a licence IN STOCK, Move to stock for one in use. The same buttons are on "
            "the record's own page.",
            "Enter how many seats, and for an assignment pick the person from the user "
            "directory; their name goes into Vendor / Used By.",
            "Moving all the seats changes the record itself. Moving some splits it: the "
            "record keeps the rest, and the moved seats join that person's (or the stock's) "
            "record for the same software, or become a new one. The price is split to match.",
        ],
    },
    {
        "id": "software-renewals",
        "title": "Get reminded before software renewals",
        "roles": (SA,),
        "route": "/masters",
        "keywords": "software renewal reminder email expiry expire licence license due notify",
        "steps": [
            "Open Master Data, choose the Notifications tab, and tick Send renewal reminders "
            "under A software is nearing its renewal date. Set the time it is sent at, and save.",
            "Also inform is emailed 30 days and again 15 days before a Renewal Date. From 7 "
            "days before, the IT head is emailed every day, with Also inform copied, until "
            "the Renewal Date is updated.",
            "The same section lists every licence within 30 days of renewal.",
        ],
    },
    {
        "id": "data-export",
        "title": "Email the registers and Activity Log as a zip, on a schedule",
        "roles": (SA,),
        "route": "/masters",
        "keywords": "export backup zip csv email schedule interval days activity log registers send data master workbook",
        "steps": [
            "Open Master Data, choose the Notifications tab, and find Scheduled data export.",
            "Add the addresses to send it to, how many days apart, and the time; tick the box "
            "and save. The mail server must be set up on the same tab.",
            "Each email carries one zip: the assets, peripherals and softwares CSVs (each "
            "register as the Report exports it) and the Activity Log since the previous export, "
            "every file named with its date (assets-2026-10-22.csv), and the Master Data workbook "
            "(master-data-2026-10-22.xlsx: a sheet per list and one for Users, which Upload workbook "
            "on Master Data takes back). It goes only to those addresses.",
            "Download the zip shows exactly what is sent; Send now emails it straight away. "
            "Neither changes the schedule.",
            "With Clear the Activity Log after each email ticked (it is, unless you untick it), "
            "every email -- scheduled or Send now -- carries the whole Activity Log and the log "
            "is then emptied. Each record's own History is kept. Download the zip never clears.",
        ],
    },
    {
        "id": "verify-entries",
        "title": "Verify new entries into the register",
        "roles": VERIFIERS,
        "route": "/verification",
        "keywords": "verify verification approve accept pending waiting check new entries reject send back discard sap id skip",
        "steps": [
            "Open Verification in the top bar. Everything added from Data Entry -- typed in or "
            "imported -- waits here, and nowhere else, until it is verified.",
            "An entry with a SAP ID does not wait: it goes straight into the register. Adding "
            "a SAP ID to an entry that is waiting (with Edit) lets it in the same way.",
            "Check each entry. Click Verify on its row, or tick several and click Verify selected.",
            "If something is wrong, click Edit to correct it, or Send back with a reason so "
            "whoever entered it can fix it. Correcting a sent-back entry puts it back in the queue.",
            "Discard (admins and superadmins) removes an entry that should never have been "
            "made, such as a duplicate. Its history is kept.",
        ],
    },
    {
        "id": "bulk-upload",
        "title": "Import many records from Excel",
        "roles": WRITERS,
        "route": "/data-entry",
        "keywords": "import upload excel bulk spreadsheet template software licence",
        "steps": [
            "Open Data Entry, choose Assets, Peripherals or Softwares at the top right, and use "
            "Download Excel template for that register's column layout; the Field Guide sheet "
            "explains every column.",
            "Fill in the first sheet and upload it in Bulk Upload.",
            "Rows that could not be imported come back as a workbook you can fix and "
            "upload again.",
        ],
    },
    {
        "id": "edit-record",
        "title": "Edit a record",
        "roles": EDITORS,
        "route": "/report",
        "keywords": "edit change update modify correct fix software licence version quantity price renewal",
        "steps": [
            "In Report, click the pencil icon on the record's row, or open the record "
            "and choose Edit.",
            "Change the fields and save. Every change is recorded in the record's history.",
            "Setting the status to IN STOCK clears the assigned user and email.",
            "For a software you can edit any of its ten fields, such as Version, Quantity, "
            "Price or Renewal Date. To give seats to someone or take them back, use Assign "
            "from stock or Move to stock instead -- they update the status, the seats and "
            "Vendor / Used By together.",
        ],
    },
    {
        "id": "bulk-edit",
        "title": "Change the same field on many records",
        "roles": WRITERS,
        "route": "/report",
        "keywords": "bulk edit many several floor move department software licence renewal",
        "steps": [
            "In Report, tick the records, then choose Edit selected.",
            "Fill in only the fields you want to change; blank boxes are left alone.",
            "Serial numbers and SAP IDs cannot be bulk-set -- each identifies one record.",
            "For softwares, only Status, Comments and the renewal date (the Warranty / AMC "
            "End box) apply; the other boxes are ignored for a licence.",
        ],
    },
    {
        "id": "transfer",
        "title": "Transfer a device to another place or person",
        "roles": WRITERS,
        "route": "/report",
        "keywords": "transfer move relocate reassign handover",
        "steps": [
            "Open the record and choose Transfer.",
            "Pick the destination location; the people list narrows to those who sit there.",
            "A peripheral that is in use moves onto an asset instead, and takes that "
            "asset's location.",
            "Software is not transferred -- see Assign software seats, or move them back to stock.",
        ],
    },
    {
        "id": "clone",
        "title": "Add a record like an existing one",
        "roles": WRITERS,
        "route": "/report",
        "keywords": "clone copy duplicate similar software licence",
        "steps": [
            "In Report, click the copy icon on the record to clone.",
            "Serial number, SAP ID, name, description, user, email, warranty, insurance and "
            "assigned date start blank; status, location, floor, department and company are "
            "carried over and can be changed.",
            "Cloning a software leaves Software Name, Serial Number and Renewal Date blank, and "
            "carries over Version, Status, Quantity, PO Number, Price, Vendor / Used By and Comment.",
        ],
    },
    {
        "id": "scrap",
        "title": "Scrap a record",
        "roles": WRITERS,
        "route": "/report",
        "keywords": "scrap delete remove retire dispose software licence cancel",
        "steps": [
            "In Report, tick the record(s) and choose Scrap.",
            "The record is kept and marked SCRAP -- nothing is erased.",
            "Only a superadmin can restore a scrapped record or delete one permanently.",
        ],
    },
    {
        "id": "restore",
        "title": "Restore a scrapped record",
        "roles": (SA,),
        "route": "/report",
        "keywords": "restore undelete undo scrap bring back",
        "steps": [
            "In Report, find the scrapped record and click its Restore icon.",
            "Choose the status to bring it back as; the one it had before is preselected.",
        ],
    },
    {
        "id": "master-data",
        "title": "Manage dropdown values (types, statuses, locations...)",
        "roles": WRITERS,
        "route": "/masters",
        "keywords": "master data dropdown values list location department company status type make "
                    "manufacturer brand",
        "steps": [
            "Open Master Data and choose the list.",
            "Makes has one list for Assets and one for Peripherals -- pick one with the buttons "
            "under the tabs. The Make field on a record offers the list for its register.",
            "Add, rename or deactivate values. Renaming a value updates every record using it.",
            "Only a superadmin can delete a value, one at a time, and a value still in use cannot "
            "be deleted -- deactivate it instead.",
        ],
    },
    {
        "id": "master-workbook",
        "title": "Download or upload all the master data at once",
        "roles": WRITERS,
        "route": "/masters",
        "keywords": "master data all workbook excel sheet download upload backup restore repopulate every list users",
        "steps": [
            "Open Master Data. The buttons under the heading act on every list at once.",
            "Download all saves one Excel workbook with a sheet per list -- Asset Types, Statuses, "
            "Departments, Companies, Locations, Floors, Asset Makes, Peripheral Makes -- giving "
            "each value's description, "
            "Active (Yes/No), Order, Shared on types, and how many records use it -- plus a "
            "Users sheet: Full Name, Email ID, Location, Date of Joining, and (to read only) "
            "Username, Profile and Active. No passwords are in the file.",
            "Uploading the Users sheet works like Bulk upload on the Users tab: people are "
            "matched by Email ID, new ones are added as assignees on the starting password, and "
            "a profile or password is never set from the file.",
            "Upload workbook fills the lists from that file: a value not in a list is added, a "
            "value already there is updated to what the sheet says (its spelling is kept), and "
            "nothing is deleted. It shows what each sheet holds before anything is saved.",
            "The same workbook is in every email of the scheduled data export.",
        ],
    },
    {
        "id": "clear-all-data",
        "title": "Clear all data (start the registers again)",
        "roles": (SA,),
        "route": "/",
        "keywords": "clear all data delete everything wipe reset empty registers start over",
        "steps": [
            "Drag the AmbujaNeotia logo in the top bar away from its place; Clear all data is "
            "behind it.",
            "Enter your password. Every record in Assets, Peripherals and Softwares is deleted with "
            "its history, and the numbering starts again at 000001.",
            "Master data, user accounts and the Activity Log are kept.",
            "Before anything is deleted, a zip of every register's CSV (entries waiting in "
            "Verification in their own file) and the Master Data workbook is downloaded to your "
            "computer.",
        ],
    },
    {
        "id": "accounts",
        "title": "Manage user accounts",
        "roles": WRITERS,
        "route": "/users",
        "keywords": "user account password profile role create reset",
        "steps": [
            "Open Master Data and choose the Users tab.",
            "Create accounts, change profiles, reset passwords or deactivate accounts.",
            "Only a superadmin can grant the superadmin profile or change a superadmin's account.",
        ],
    },
    {
        "id": "activity-log",
        "title": "See who did what (Activity Log)",
        "roles": (SA,),
        "route": "/activity",
        "keywords": "activity log audit who did sign in refused",
        "steps": [
            "Open Activity in the top bar.",
            "Filter by person, area, outcome or date; export to CSV, Excel or PDF.",
        ],
    },
    {
        "id": "assistant-modes",
        "title": "What the assistant can and cannot do",
        "roles": EVERYONE,
        "route": None,
        "keywords": "assistant ai help mode answer changes confirm",
        "steps": [
            "The assistant answers questions about this app and its records only.",
            "In Answer only mode it looks things up and explains how to do them.",
            "In Can make changes mode (admins and superadmins) it can prepare an edit, "
            "a transfer, or a software assignment or return to stock, for you to confirm. "
            "Nothing changes until you press Confirm, "
            "and the change is made exactly as if you had made it yourself.",
            "Every change you confirm is recorded in the Activity Log and the record's history. "
            "Your conversations are kept in the assistant's History tab.",
        ],
    },
]


def topics_for(role: str) -> list[dict]:
    return [t for t in GUIDE if role in t["roles"]]


def search(role: str, query: str, limit: int = 4) -> list[dict]:
    words = {w for w in (query or "").lower().replace("/", " ").split() if len(w) > 2}
    scored = []
    for topic in topics_for(role):
        hay = f"{topic['title']} {topic['keywords']}".lower()
        score = sum(1 for w in words if w in hay)
        if score:
            scored.append((score, topic))
    scored.sort(key=lambda s: -s[0])
    return [t for _, t in scored[:limit]]


def public(topic: dict) -> dict:
    return {k: topic[k] for k in ("id", "title", "route", "steps")}

