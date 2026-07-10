alter table booking_payment_admin_actions
  drop constraint if exists booking_payment_admin_actions_action_check;

alter table booking_payment_admin_actions
  add constraint booking_payment_admin_actions_action_check
    check (action in (
      'resend_payment_link',
      'resend_receipt',
      'mark_finance_review',
      'record_credit_note',
      'request_refund',
      'mark_voucher_reconciled',
      'mark_fallback_card_charge'
    ));

alter table booking_payment_admin_actions
  drop constraint if exists booking_payment_admin_actions_status_check;

alter table booking_payment_admin_actions
  add constraint booking_payment_admin_actions_status_check
    check (status in ('queued', 'sent', 'recorded', 'review_required', 'completed', 'failed'));
