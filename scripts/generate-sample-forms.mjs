import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const formsRoot = path.join(rootDir, 'public', 'forms');

function escapePdfText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' ');
}

/**
 * Generates a valid, multi-page PDF 1.4 document with clean vector form fields,
 * checkboxes, tables, and signature blocks using exact byte-offset xref tables.
 */
function buildPdfDocument({ code, title, department, revision, pages }) {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Font objects (Standard Type1 fonts require no embedding)
  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const fontMonoId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

  const pageIds = [];
  const totalPages = pages.length;

  // Reserve Pages object ID (we will fill it after creating page objects)
  const pagesContainerId = addObject('');

  pages.forEach((pageSpec, pageIndex) => {
    const cmds = [];

    // Header band
    cmds.push('0.118 0.227 0.541 rg'); // Deep lapis #1E3A8A
    cmds.push('48 742 516 34 re f');

    // Header text (white)
    cmds.push('1 1 1 rg');
    cmds.push(`BT /F2 11 Tf 60 755 Td (${escapePdfText(code)}  |  ${escapePdfText(department.toUpperCase())}) Tj ET`);
    cmds.push(`BT /F1 9 Tf 450 755 Td (Rev. ${escapePdfText(revision)}) Tj ET`);

    // Document Title
    cmds.push('0.059 0.090 0.165 rg'); // Slate 900
    cmds.push(`BT /F2 18 Tf 48 708 Td (${escapePdfText(title)}) Tj ET`);

    // Subtitle / Instructions
    cmds.push('0.278 0.333 0.412 rg'); // Slate 600
    cmds.push(`BT /F1 9.5 Tf 48 690 Td (${escapePdfText(pageSpec.subtitle || 'Complete all applicable fields clearly in block letters or digitally before submission.')}) Tj ET`);

    // Top rule
    cmds.push('0.80 0.84 0.88 RG 0.75 w 48 678 m 564 678 l S');

    let cursorY = 656;

    for (const section of pageSpec.sections) {
      // Section header bar
      cmds.push('0.945 0.961 0.976 rg'); // Slate 100
      cmds.push(`48 ${cursorY - 6} 516 20 re f`);
      cmds.push('0.118 0.227 0.541 rg');
      cmds.push(`BT /F2 10 Tf 56 ${cursorY} Td (${escapePdfText(section.heading)}) Tj ET`);
      cursorY -= 26;

      if (section.type === 'fields') {
        for (const row of section.rows) {
          const colCount = row.length;
          const gap = 12;
          const totalWidth = 516;
          const colWidth = (totalWidth - gap * (colCount - 1)) / colCount;

          row.forEach((fieldLabel, idx) => {
            const x = 48 + idx * (colWidth + gap);
            // Field label
            cmds.push('0.20 0.25 0.33 rg');
            cmds.push(`BT /F1 8.5 Tf ${x} ${cursorY} Td (${escapePdfText(fieldLabel)}) Tj ET`);
            // Input box
            cmds.push('0.78 0.82 0.87 RG 0.75 w');
            cmds.push(`${x} ${cursorY - 24} ${colWidth.toFixed(1)} 19 re S`);
          });

          cursorY -= 38;
        }
      } else if (section.type === 'checkboxes') {
        for (const item of section.items) {
          cmds.push('0.39 0.45 0.54 RG 0.8 w');
          cmds.push(`52 ${cursorY - 2} 10 10 re S`);
          cmds.push('0.12 0.16 0.23 rg');
          cmds.push(`BT /F1 9.5 Tf 70 ${cursorY} Td (${escapePdfText(item)}) Tj ET`);
          cursorY -= 19;
        }
        cursorY -= 6;
      } else if (section.type === 'table') {
        const headers = section.headers;
        const rowsCount = section.emptyRows || 4;
        const colWidths = section.colWidths || headers.map(() => 516 / headers.length);

        // Table header
        cmds.push('0.91 0.93 0.96 rg');
        cmds.push(`48 ${cursorY - 4} 516 18 re f`);
        cmds.push('0.68 0.73 0.80 RG 0.75 w');
        cmds.push(`48 ${cursorY - 4} 516 18 re S`);

        let cx = 48;
        headers.forEach((h, i) => {
          cmds.push('0.06 0.09 0.16 rg');
          cmds.push(`BT /F2 8.5 Tf ${cx + 6} ${cursorY + 1} Td (${escapePdfText(h)}) Tj ET`);
          cx += colWidths[i];
          if (i < headers.length - 1) {
            cmds.push(`${cx} ${cursorY - 4} m ${cx} ${cursorY + 14} l S`);
          }
        });
        cursorY -= 18;

        for (let r = 0; r < rowsCount; r++) {
          cmds.push('0.78 0.82 0.87 RG 0.6 w');
          cmds.push(`48 ${cursorY - 4} 516 20 re S`);
          let vx = 48;
          for (let i = 0; i < headers.length - 1; i++) {
            vx += colWidths[i];
            cmds.push(`${vx} ${cursorY - 4} m ${vx} ${cursorY + 16} l S`);
          }
          if (section.sampleRows && section.sampleRows[r]) {
            let sx = 48;
            section.sampleRows[r].forEach((val, ci) => {
              cmds.push('0.20 0.25 0.33 rg');
              cmds.push(`BT /F1 8.5 Tf ${sx + 6} ${cursorY + 2} Td (${escapePdfText(val)}) Tj ET`);
              sx += colWidths[ci];
            });
          }
          cursorY -= 20;
        }
        cursorY -= 12;
      } else if (section.type === 'notes') {
        for (const line of section.lines) {
          cmds.push('0.20 0.25 0.33 rg');
          cmds.push(`BT /F1 9 Tf 52 ${cursorY} Td (${escapePdfText(line)}) Tj ET`);
          cursorY -= 14;
        }
        cursorY -= 8;
      } else if (section.type === 'signature') {
        cursorY -= 6;
        const boxWidth = 248;
        // Left signature
        cmds.push('0.68 0.73 0.80 RG 0.75 w');
        cmds.push(`48 ${cursorY - 34} ${boxWidth} 36 re S`);
        cmds.push('0.20 0.25 0.33 rg');
        cmds.push(`BT /F1 8.5 Tf 54 ${cursorY - 46} Td (${escapePdfText(section.leftLabel || 'Applicant Signature & Date')}) Tj ET`);

        // Right signature
        cmds.push('0.68 0.73 0.80 RG 0.75 w');
        cmds.push(`316 ${cursorY - 34} ${boxWidth} 36 re S`);
        cmds.push('0.20 0.25 0.33 rg');
        cmds.push(`BT /F1 8.5 Tf 322 ${cursorY - 46} Td (${escapePdfText(section.rightLabel || 'Authorized Approval & Date')}) Tj ET`);
        cursorY -= 64;
      }
    }

    // Footer rule & pagination
    cmds.push('0.85 0.88 0.91 RG 0.6 w 48 48 m 564 48 l S');
    cmds.push('0.45 0.50 0.58 rg');
    cmds.push(`BT /F3 8 Tf 48 34 Td (${escapePdfText(code)}  //  Standard Static Repository Form) Tj ET`);
    cmds.push(`BT /F1 8.5 Tf 504 34 Td (Page ${pageIndex + 1} of ${totalPages}) Tj ET`);

    const streamContent = cmds.join('\n');
    const streamLength = Buffer.byteLength(streamContent, 'latin1');
    const contentId = addObject(`<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesContainerId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontMonoId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  });

  // Fill Pages container
  objects[pagesContainerId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesContainerId} 0 R >>`);

  // Assemble PDF with exact byte offsets
  const chunks = ['%PDF-1.4\n'];
  let byteOffset = Buffer.byteLength(chunks[0], 'latin1');
  const offsets = [0];

  objects.forEach((body, idx) => {
    offsets.push(byteOffset);
    const objStr = `${idx + 1} 0 obj\n${body}\nendobj\n`;
    chunks.push(objStr);
    byteOffset += Buffer.byteLength(objStr, 'latin1');
  });

  const xrefOffset = byteOffset;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }

  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(chunks.join(''), 'latin1');
}

const formDefinitions = [
  {
    relPath: '01-Human-Resources/Onboarding/HR-101-Employee-Onboarding-Checklist.pdf',
    type: 'pdf',
    spec: {
      code: 'HR-101',
      title: 'Employee Onboarding Checklist',
      department: 'Human Resources',
      revision: '2026.2',
      pages: [
        {
          subtitle: 'Required pre-boarding and Day-1 verification checklist for new full-time and contract personnel.',
          sections: [
            {
              heading: '1. Employee Identification',
              type: 'fields',
              rows: [
                ['Full Legal Name', 'Employee ID (Assigned)'],
                ['Department / Cost Center', 'Start Date (YYYY-MM-DD)', 'Work Location'],
                ['Reporting Manager Name', 'Corporate Email Address'],
              ],
            },
            {
              heading: '2. Day-1 Documentation Verification',
              type: 'checkboxes',
              items: [
                'Signed Employment Agreement and Confidentiality Addendum received',
                'Government-issued photo identification verified for payroll compliance',
                'Direct Deposit Authorization (Form HR-104) submitted to Payroll',
                'Emergency Contact & Beneficiary Form (Form HR-108) completed',
                'Workstation and Security Badge request (Form OPS-501) approved',
              ],
            },
            {
              heading: '3. IT & Policy Orientation',
              type: 'checkboxes',
              items: [
                'Single Sign-On (SSO) and Multi-Factor Authentication activated',
                'Information Security Policy Acknowledgement (LEG-704) signed',
                'Benefits enrollment briefing scheduled within first 14 calendar days',
              ],
            },
          ],
        },
        {
          subtitle: 'Page 2: Supervisor Sign-off and 30-Day Probation Review Milestones.',
          sections: [
            {
              heading: '4. 30-Day Milestone Schedule',
              type: 'table',
              headers: ['Milestone', 'Target Date', 'Owner', 'Status'],
              colWidths: [216, 100, 120, 80],
              emptyRows: 4,
              sampleRows: [
                ['Departmental Tooling & Access Audit', 'Day 7', 'IT Operations', 'Pending'],
                ['Role Objectives & KPI Alignment', 'Day 14', 'Line Manager', 'Pending'],
                ['Compliance Training Modules', 'Day 21', 'HR Compliance', 'Pending'],
                ['30-Day Check-In Evaluation', 'Day 30', 'Manager & HR', 'Pending'],
              ],
            },
            {
              heading: '5. Completion & Filing Certification',
              type: 'notes',
              lines: [
                'Submit the completed two-page form to Human Resources Operations within 5 business days of the start date.',
                'Retain a copy in the departmental personnel binder for annual audit verification.',
              ],
            },
            {
              heading: '6. Signatures',
              type: 'signature',
              leftLabel: 'Employee Signature & Date',
              rightLabel: 'HR Coordinator Signature & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '01-Human-Resources/Onboarding/HR-104-Direct-Deposit-Authorization.pdf',
    type: 'pdf',
    spec: {
      code: 'HR-104',
      title: 'Direct Deposit Authorization',
      department: 'Human Resources & Payroll',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Authorize electronic ACH payroll deposits into up to two designated checking or savings accounts.',
          sections: [
            {
              heading: '1. Payee Details',
              type: 'fields',
              rows: [
                ['Employee Full Name', 'Employee ID'],
                ['Work Email', 'Effective Pay Cycle Date'],
              ],
            },
            {
              heading: '2. Primary Financial Institution',
              type: 'fields',
              rows: [
                ['Bank / Credit Union Name', 'Account Type (Checking / Savings)'],
                ['Routing / Transit Number (9 digits)', 'Account Number'],
                ['Allocation (100% or Fixed Amount)', 'Action (New / Change / Cancel)'],
              ],
            },
            {
              heading: '3. Authorization Statement',
              type: 'notes',
              lines: [
                'I hereby authorize Payroll Services to initiate credit entries—and, if necessary, debit adjustments for',
                'entries made in error—to the financial account specified above. Attach a voided check or bank letter.',
              ],
            },
            {
              heading: '4. Payee Signature',
              type: 'signature',
              leftLabel: 'Employee Signature & Date',
              rightLabel: 'Payroll Verification & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '01-Human-Resources/Onboarding/HR-108-Emergency-Contact-Form.pdf',
    type: 'pdf',
    spec: {
      code: 'HR-108',
      title: 'Emergency Contact & Medical Alert Form',
      department: 'Human Resources',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Confidential personnel record maintained strictly for workplace safety and emergency response.',
          sections: [
            {
              heading: '1. Employee Information',
              type: 'fields',
              rows: [
                ['Full Name', 'Department'],
                ['Primary Mobile Phone', 'Home Street Address'],
              ],
            },
            {
              heading: '2. Primary Emergency Contact',
              type: 'fields',
              rows: [
                ['Contact Full Name', 'Relationship'],
                ['Primary Telephone', 'Alternate Telephone'],
              ],
            },
            {
              heading: '3. Secondary Emergency Contact',
              type: 'fields',
              rows: [
                ['Contact Full Name', 'Relationship'],
                ['Primary Telephone', 'City / State'],
              ],
            },
            {
              heading: '4. Acknowledgement',
              type: 'signature',
              leftLabel: 'Employee Signature & Date',
              rightLabel: 'HR Filing Initials & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '01-Human-Resources/Leave-and-Benefits/HR-201-Annual-Leave-Request.pdf',
    type: 'pdf',
    spec: {
      code: 'HR-201',
      title: 'Annual Leave & Time-Off Request',
      department: 'Human Resources',
      revision: '2026.3',
      pages: [
        {
          subtitle: 'Submit at least 10 business days prior to planned leave exceeding 3 consecutive working days.',
          sections: [
            {
              heading: '1. Applicant Details',
              type: 'fields',
              rows: [
                ['Employee Name', 'Employee ID', 'Department'],
                ['Leave Start Date', 'Leave End Date', 'Total Working Days'],
              ],
            },
            {
              heading: '2. Leave Classification',
              type: 'checkboxes',
              items: [
                'Annual Paid Vacation Leave',
                'Personal / Floating Holiday',
                'Bereavement or Compassionate Leave',
                'Unpaid Leave of Absence (Requires HR Director Countersignature)',
              ],
            },
            {
              heading: '3. Coverage & Handover Plan',
              type: 'fields',
              rows: [
                ['Designated Backup Colleague', 'Emergency Contactable Number (Optional)'],
              ],
            },
            {
              heading: '4. Approvals',
              type: 'signature',
              leftLabel: 'Employee Signature & Date',
              rightLabel: 'Manager Approval & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '01-Human-Resources/Leave-and-Benefits/HR-205-Medical-Reimbursement-Claim.pdf',
    type: 'pdf',
    spec: {
      code: 'HR-205',
      title: 'Medical & Wellness Reimbursement Claim',
      department: 'Benefits Administration',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Attach itemized provider receipts showing patient name, service date, and payment confirmation.',
          sections: [
            {
              heading: '1. Claimant Information',
              type: 'fields',
              rows: [
                ['Employee Full Name', 'Employee ID', 'Plan Tier'],
              ],
            },
            {
              heading: '2. Itemized Medical Expenses',
              type: 'table',
              headers: ['Service Date', 'Provider / Clinic', 'Benefit Category', 'Amount'],
              colWidths: [90, 196, 140, 90],
              emptyRows: 5,
            },
            {
              heading: '3. Claimant Certification',
              type: 'notes',
              lines: [
                'I certify that the expenses listed above were incurred for eligible medical or wellness services and have not',
                'been reimbursed by any other insurance plan.',
              ],
            },
            {
              heading: '4. Signatures',
              type: 'signature',
              leftLabel: 'Claimant Signature & Date',
              rightLabel: 'Benefits Administrator & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '01-Human-Resources/Leave-and-Benefits/HR-212-Parental-Leave-Application.pdf',
    type: 'pdf',
    spec: {
      code: 'HR-212',
      title: 'Parental Leave Application',
      department: 'Human Resources',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'For birth, adoption, or foster care placement bonding leave under company family benefit policy.',
          sections: [
            {
              heading: '1. Employee & Expected Dates',
              type: 'fields',
              rows: [
                ['Employee Full Name', 'Employee ID'],
                ['Expected Birth / Placement Date', 'Proposed Leave Start Date'],
                ['Planned Return-to-Work Date', 'Leave Schedule (Continuous / Intermittent)'],
              ],
            },
            {
              heading: '2. Supporting Documentation Checklist',
              type: 'checkboxes',
              items: [
                'Medical certification or adoption placement notice attached',
                'Short-term disability coordination form reviewed (if applicable)',
                'Transition memo shared with immediate supervisor',
              ],
            },
            {
              heading: '3. Signatures',
              type: 'signature',
              leftLabel: 'Employee Signature & Date',
              rightLabel: 'HR Benefits Partner & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '02-Finance-and-Tax/Expense-Claims/FIN-301-Travel-Expense-Voucher.pdf',
    type: 'pdf',
    spec: {
      code: 'FIN-301',
      title: 'Travel & Business Expense Voucher',
      department: 'Finance & Accounting',
      revision: '2026.4',
      pages: [
        {
          subtitle: 'Submit within 15 days of trip completion along with digital or physical GST/VAT receipts.',
          sections: [
            {
              heading: '1. Traveler & Trip Summary',
              type: 'fields',
              rows: [
                ['Employee Name', 'Cost Center / Project Code'],
                ['Destination City', 'Departure Date', 'Return Date'],
                ['Business Purpose of Travel', 'Advance Received (if any)'],
              ],
            },
            {
              heading: '2. Expense Breakdown',
              type: 'table',
              headers: ['Date', 'Category', 'Merchant / Description', 'Currency', 'Total'],
              colWidths: [72, 108, 186, 68, 82],
              emptyRows: 6,
            },
            {
              heading: '3. Approval Sign-off',
              type: 'signature',
              leftLabel: 'Traveler Signature & Date',
              rightLabel: 'Budget Owner Approval & Date',
            },
          ],
        },
        {
          subtitle: 'Page 2: Per-Diem Policy Guidelines and Foreign Exchange Conversion Log.',
          sections: [
            {
              heading: '4. Foreign Currency Conversion Schedule',
              type: 'table',
              headers: ['Original Currency', 'Original Amount', 'Exchange Rate', 'Base Total'],
              colWidths: [120, 132, 132, 132],
              emptyRows: 4,
            },
            {
              heading: '5. Audit & Compliance Notes',
              type: 'notes',
              lines: [
                '1. Refer to FIN-309-Per-Diem-Rate-Schedule.csv in this folder for current domestic and international meal caps.',
                '2. Lodging invoices must display nightly room rates separately from incidental charges.',
                '3. Airfare claims require boarding confirmation or e-ticket itinerary showing fare class.',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '02-Finance-and-Tax/Expense-Claims/FIN-304-Petty-Cash-Requisition.pdf',
    type: 'pdf',
    spec: {
      code: 'FIN-304',
      title: 'Petty Cash Requisition Voucher',
      department: 'Finance & Treasury',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'For minor urgent operational disbursements under $250 not covered by corporate purchase orders.',
          sections: [
            {
              heading: '1. Requisition Details',
              type: 'fields',
              rows: [
                ['Requester Name', 'Department', 'Date'],
                ['GL Account Code', 'Requested Amount', 'Currency'],
                ['Itemized Purpose / Vendor', 'Receipt Attached (Yes / Pending)'],
              ],
            },
            {
              heading: '2. Disbursement Confirmation',
              type: 'signature',
              leftLabel: 'Recipient Signature & Date',
              rightLabel: 'Treasury Custodian & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '02-Finance-and-Tax/Expense-Claims/FIN-309-Per-Diem-Rate-Schedule.csv',
    type: 'raw',
    content: `Region,City / Tier,Lodging Cap (USD),Meals & Incidentals (USD),Effective Date,Currency Code
North America,Tier 1 (NYC / SF / DC),295.00,79.00,2026-01-01,USD
North America,Tier 2 (Standard Metro),195.00,64.00,2026-01-01,USD
Europe,London / Zurich / Paris,280.00,85.00,2026-01-01,EUR
Europe,Regional Capitals,185.00,68.00,2026-01-01,EUR
Asia-Pacific,Singapore / Tokyo,260.00,75.00,2026-01-01,SGD
Asia-Pacific,Regional Hubs,155.00,52.00,2026-01-01,USD
`,
  },
  {
    relPath: '02-Finance-and-Tax/Tax-Declarations/FIN-401-Annual-Withholding-Declaration.pdf',
    type: 'pdf',
    spec: {
      code: 'FIN-401',
      title: 'Annual Tax Withholding Declaration',
      department: 'Tax & Payroll Compliance',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Annual employee declaration of tax exemptions, deductions, and filing status for fiscal year 2026.',
          sections: [
            {
              heading: '1. Taxpayer Identification',
              type: 'fields',
              rows: [
                ['Full Legal Name', 'Tax Identification / SSN (Last 4)'],
                ['Residential Address', 'Fiscal Year'],
              ],
            },
            {
              heading: '2. Filing Status',
              type: 'checkboxes',
              items: [
                'Single or Married filing separately',
                'Married filing jointly',
                'Head of household',
              ],
            },
            {
              heading: '3. Additional Deductions & Credits',
              type: 'fields',
              rows: [
                ['Declared Dependent Allowance', 'Extra Per-Period Withholding (Optional)'],
              ],
            },
            {
              heading: '4. Declaration Under Penalty of Perjury',
              type: 'signature',
              leftLabel: 'Taxpayer Signature & Date',
              rightLabel: 'Payroll Tax Officer & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '02-Finance-and-Tax/Tax-Declarations/FIN-405-Vendor-Tax-Registration.pdf',
    type: 'pdf',
    spec: {
      code: 'FIN-405',
      title: 'Vendor Tax Registration & Remittance Form',
      department: 'Accounts Payable',
      revision: '2026.2',
      pages: [
        {
          subtitle: 'Mandatory onboarding form for new external suppliers prior to purchase order issuance.',
          sections: [
            {
              heading: '1. Legal Entity Information',
              type: 'fields',
              rows: [
                ['Registered Business Name', 'Trade / DBA Name'],
                ['Federal Tax ID / EIN / VAT No.', 'Entity Type (LLC / Corp / Sole Prop)'],
                ['Remittance Street Address', 'Accounts Receivable Email'],
              ],
            },
            {
              heading: '2. Settlement Preferences',
              type: 'fields',
              rows: [
                ['Bank Name', 'ACH Routing / IBAN'],
                ['Account Number', 'Payment Terms (Net 30 / Net 45)'],
              ],
            },
            {
              heading: '3. Authorized Officer',
              type: 'signature',
              leftLabel: 'Vendor Authorized Signatory & Date',
              rightLabel: 'Procurement Review & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '03-Operations-and-Facilities/Access-and-Security/OPS-501-Building-Access-Badge-Request.pdf',
    type: 'pdf',
    spec: {
      code: 'OPS-501',
      title: 'Building Access Badge & Keycard Request',
      department: 'Facilities & Physical Security',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Issued to verified employees, interns, and long-term contractors requiring facility entry.',
          sections: [
            {
              heading: '1. Cardholder Details',
              type: 'fields',
              rows: [
                ['Full Name', 'Employee / Contractor ID'],
                ['Department', 'Sponsoring Manager'],
              ],
            },
            {
              heading: '2. Requested Access Zones',
              type: 'checkboxes',
              items: [
                'Main Campus Lobby & Common Floors (Standard Hours 07:00-20:00)',
                '24/7 Extended Operations Access (Requires Director Sign-off)',
                'Server Room / Secure Lab Annex (Requires Security Clearance)',
                'Parking Garage Transponder Activation',
              ],
            },
            {
              heading: '3. Security Desk Authorization',
              type: 'signature',
              leftLabel: 'Applicant Signature & Date',
              rightLabel: 'Facilities Security Officer & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '03-Operations-and-Facilities/Access-and-Security/OPS-503-Visitor-NDA-Acknowledgement.pdf',
    type: 'pdf',
    spec: {
      code: 'OPS-503',
      title: 'Visitor Non-Disclosure Acknowledgement',
      department: 'Facilities & Security',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Required at reception for all external guests entering non-public engineering or operational areas.',
          sections: [
            {
              heading: '1. Visitor Identification',
              type: 'fields',
              rows: [
                ['Visitor Full Name', 'Organization / Company'],
                ['Host Employee Name', 'Visit Date & Temporary Badge No.'],
              ],
            },
            {
              heading: '2. Confidentiality Covenants',
              type: 'notes',
              lines: [
                'During your visit, you may observe proprietary processes, prototypes, or confidential business materials.',
                'Photography, audio recording, and unauthorized removal of documents are strictly prohibited on premises.',
              ],
            },
            {
              heading: '3. Sign-in Confirmation',
              type: 'signature',
              leftLabel: 'Visitor Signature & Date',
              rightLabel: 'Host Employee Signature & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '03-Operations-and-Facilities/IT-Equipment/OPS-601-Hardware-Asset-Checkout.pdf',
    type: 'pdf',
    spec: {
      code: 'OPS-601',
      title: 'IT Hardware Asset Checkout & Custody',
      department: 'IT Asset Management',
      revision: '2026.2',
      pages: [
        {
          subtitle: 'Records serial numbers and condition of laptops, monitors, and peripherals assigned to staff.',
          sections: [
            {
              heading: '1. Custodian Details',
              type: 'fields',
              rows: [
                ['Assigned Employee Name', 'Department', 'Checkout Date'],
              ],
            },
            {
              heading: '2. Assigned Equipment Inventory',
              type: 'table',
              headers: ['Asset Tag', 'Device Type / Model', 'Serial Number', 'Condition'],
              colWidths: [96, 190, 140, 90],
              emptyRows: 5,
            },
            {
              heading: '3. Custody Agreement',
              type: 'signature',
              leftLabel: 'Employee Receipt Signature & Date',
              rightLabel: 'IT Technician Release & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '03-Operations-and-Facilities/IT-Equipment/OPS-604-VPN-Remote-Access-Request.pdf',
    type: 'pdf',
    spec: {
      code: 'OPS-604',
      title: 'VPN & Remote Infrastructure Access Request',
      department: 'Information Security & IT',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Provisioning request for encrypted tunnel access to internal repositories and staging environments.',
          sections: [
            {
              heading: '1. Requester Profile',
              type: 'fields',
              rows: [
                ['Full Name', 'Corporate Username'],
                ['Assigned Workstation Asset Tag', 'Access Duration (Permanent / Project End Date)'],
              ],
            },
            {
              heading: '2. Target Network Profiles',
              type: 'checkboxes',
              items: [
                'Standard Corporate Intranet & File Shares',
                'Engineering Staging & Build Cluster',
                'Production Read-Only Diagnostics Bastion (Requires Security Approval)',
              ],
            },
            {
              heading: '3. Authorizations',
              type: 'signature',
              leftLabel: 'Requester Signature & Date',
              rightLabel: 'IT Security Approver & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '04-Compliance-and-Legal/Privacy-and-Policy/LEG-701-Data-Processing-Addendum.pdf',
    type: 'pdf',
    spec: {
      code: 'LEG-701',
      title: 'Standard Data Processing Addendum (DPA)',
      department: 'Legal & Privacy',
      revision: '2026.2',
      pages: [
        {
          subtitle: 'Standard contractual clauses governing processor obligations under GDPR and regional privacy statutes.',
          sections: [
            {
              heading: '1. Contracting Parties',
              type: 'fields',
              rows: [
                ['Data Controller Legal Name', 'Jurisdiction / Registration No.'],
                ['Data Processor Legal Name', 'Master Agreement Effective Date'],
              ],
            },
            {
              heading: '2. Scope & Categories of Personal Data',
              type: 'checkboxes',
              items: [
                'Contact & Identity Metadata (Name, Corporate Email, Role)',
                'Billing & Financial Transaction Records',
                'System Telemetry & Audit Access Logs',
              ],
            },
            {
              heading: '3. Technical & Organizational Safeguards',
              type: 'notes',
              lines: [
                'Processor shall maintain AES-256 encryption at rest, TLS 1.3 in transit, role-based access control,',
                'and notify Controller without undue delay (within 48 hours) upon confirming any personal data breach.',
              ],
            },
          ],
        },
        {
          subtitle: 'Page 2: Authorized Sub-Processors and Execution Block.',
          sections: [
            {
              heading: '4. Approved Sub-Processor Register',
              type: 'table',
              headers: ['Sub-Processor Name', 'Processing Activity', 'Hosting Region'],
              colWidths: [180, 216, 120],
              emptyRows: 4,
            },
            {
              heading: '5. Execution',
              type: 'signature',
              leftLabel: 'Controller Authorized Signatory & Date',
              rightLabel: 'Processor Authorized Signatory & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '04-Compliance-and-Legal/Privacy-and-Policy/LEG-704-Information-Security-Acknowledgement.pdf',
    type: 'pdf',
    spec: {
      code: 'LEG-704',
      title: 'Information Security Policy Acknowledgement',
      department: 'Legal & Compliance',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Annual employee attestation confirming receipt and compliance with the Corporate Security Handbook.',
          sections: [
            {
              heading: '1. Personnel Identification',
              type: 'fields',
              rows: [
                ['Employee Full Name', 'Employee ID', 'Department'],
              ],
            },
            {
              heading: '2. Policy Attestation Points',
              type: 'checkboxes',
              items: [
                'I will protect authentication credentials and never share hardware tokens or passwords',
                'I will report suspected phishing, lost devices, or data exposure immediately to Security',
                'I understand company-issued devices are subject to automated endpoint encryption policies',
              ],
            },
            {
              heading: '3. Signature',
              type: 'signature',
              leftLabel: 'Employee Signature & Date',
              rightLabel: 'Compliance Officer & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '04-Compliance-and-Legal/Privacy-and-Policy/LEG-709-Submission-Guidelines.txt',
    type: 'raw',
    content: `LEGAL & COMPLIANCE DOCUMENT SUBMISSION GUIDELINES (REV 2026.2)
====================================================================

1. NAMING CONVENTION
   Save executed PDF forms using the following format before archiving:
   <FORM-CODE>_<YYYY-MM-DD>_<LASTNAME>.pdf
   Example: LEG-701_2026-11-17_AcmeCorp.pdf

2. SIGNATURE REQUIREMENTS
   - Digital signatures with verifiable cryptographic timestamps are accepted.
   - Wet-ink scans must be exported at a minimum resolution of 300 DPI in PDF/A format.

3. RETENTION SCHEDULE
   - Data Processing Addenda (LEG-701): Active Term + 7 Years
   - Security Acknowledgements (LEG-704): Active Employment + 3 Years
   - Conflict of Interest Disclosures (LEG-805): 5 Fiscal Years

4. ARCHIVE CONTACT
   Compliance Operations Desk · compliance-archive@organization.example
`,
  },
  {
    relPath: '04-Compliance-and-Legal/Templates/LEG-801-Standard-Service-Agreement.pdf',
    type: 'pdf',
    spec: {
      code: 'LEG-801',
      title: 'Standard Master Service Agreement Cover Sheet',
      department: 'Legal Counsel',
      revision: '2026.3',
      pages: [
        {
          subtitle: 'Cover sheet and commercial schedule accompanying Statements of Work (SOW).',
          sections: [
            {
              heading: '1. Agreement Parties & Term',
              type: 'fields',
              rows: [
                ['Client Legal Name', 'Service Provider Legal Name'],
                ['Effective Date', 'Initial Term (Months)', 'Governing Law'],
              ],
            },
            {
              heading: '2. Commercial Terms Summary',
              type: 'fields',
              rows: [
                ['Billing Currency & Cycle', 'Payment Terms (Days from Invoice)'],
                ['Liability Cap Multiple', 'Notice Period for Non-Renewal'],
              ],
            },
            {
              heading: '3. Legal Execution',
              type: 'signature',
              leftLabel: 'Client Signatory & Date',
              rightLabel: 'Provider Signatory & Date',
            },
          ],
        },
      ],
    },
  },
  {
    relPath: '04-Compliance-and-Legal/Templates/LEG-805-Conflict-of-Interest-Disclosure.pdf',
    type: 'pdf',
    spec: {
      code: 'LEG-805',
      title: 'Annual Conflict of Interest Disclosure',
      department: 'Ethics & Compliance',
      revision: '2026.1',
      pages: [
        {
          subtitle: 'Required disclosure of outside board seats, vendor relationships, or financial interests.',
          sections: [
            {
              heading: '1. Disclosing Individual',
              type: 'fields',
              rows: [
                ['Full Name', 'Title / Role', 'Department'],
              ],
            },
            {
              heading: '2. Disclosure Status',
              type: 'checkboxes',
              items: [
                'I have NO outside financial, advisory, or familial interests to disclose for the current year',
                'I HAVE potential conflicts to disclose as itemized in Section 3 below',
              ],
            },
            {
              heading: '3. Disclosed Entities (If Applicable)',
              type: 'table',
              headers: ['External Entity Name', 'Nature of Relationship', 'Mitigation / Recusal'],
              colWidths: [170, 173, 173],
              emptyRows: 3,
            },
            {
              heading: '4. Attestation',
              type: 'signature',
              leftLabel: 'Employee Signature & Date',
              rightLabel: 'Ethics Committee Review & Date',
            },
          ],
        },
      ],
    },
  },
];

// Clean and recreate public/forms
fs.rmSync(formsRoot, { recursive: true, force: true });

for (const item of formDefinitions) {
  const outPath = path.join(formsRoot, item.relPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (item.type === 'pdf') {
    const buffer = buildPdfDocument(item.spec);
    fs.writeFileSync(outPath, buffer);
  } else {
    fs.writeFileSync(outPath, item.content, 'utf8');
  }
}

console.log(`Generated ${formDefinitions.length} static files in ${formsRoot}`);
