const REPAIR_DATABASE_COLUMNS_ = {
  Repair_Master: 'repair_id srn reported_at customer_id machine_id brand model serial_number initial_service_type current_location_type issue_description assigned_engineer_id status priority error_code initial_findings root_cause due_date attachments received_at_company_at storage_location received_by repair_started_at returned_to_customer_at repair_completed_at test_result final_outcome closed_at close_note service_report_url hold_reason next_action created_at created_by updated_at updated_by',
  Repair_History: 'event_id repair_id occurred_at actor event_type old_value new_value note',
  Service_Visits: 'visit_id repair_id scheduled_visit_at actual_visit_at site_location visit_engineer_id visit_findings follow_up_required next_visit_at created_at created_by',
  Repair_Attempts: 'attempt_id repair_id attempt_no visit_id attempt_at engineer_id location_type symptom_before actions_taken parts_replaced test_result remaining_symptom failure_reason failure_note next_action next_owner_id created_at created_by',
  Customers: 'customer_id customer_name active',
  Machines: 'machine_id customer_id brand model serial_number active',
  Technicians: 'technician_id display_name active',
  Quotations: 'quotation_id repair_id quotation_number quoted_at quoted_amount_thb quotation_status description rejection_reason decision_at image_drive_id image_drive_path created_at created_by updated_at updated_by',
  Settings: 'config_key config_value',
  Users: 'user_email role active',
  Request_Log: 'request_id operation result_json created_at actor'
};

function repairSheetHeaders_() {
  return Object.fromEntries(
    Object.entries(REPAIR_DATABASE_COLUMNS_).map(([name, headers]) => [name, headers.split(' ')])
  );
}