import type { ToolDefinition } from "@/lib/crm-tools/define-tool";
import type { ToolName } from "@/lib/crm-tools/catalog";
import bookingSetDayHours from "@/lib/crm-tools/tools/booking_set_day_hours";
import convertEventTimezone from "@/lib/crm-tools/tools/convert_event_timezone";
import createCalendarEvent from "@/lib/crm-tools/tools/create_calendar_event";
import createContact from "@/lib/crm-tools/tools/create_contact";
import createPromoCode from "@/lib/crm-tools/tools/create_promo_code";
import createStaffUser from "@/lib/crm-tools/tools/create_staff_user";
import createTherapyEnrollment from "@/lib/crm-tools/tools/create_therapy_enrollment";
import createWorkshop from "@/lib/crm-tools/tools/create_workshop";
import createWorkshopProduct from "@/lib/crm-tools/tools/create_workshop_product";
import crmStats from "@/lib/crm-tools/tools/crm_stats";
import dashboardStats from "@/lib/crm-tools/tools/dashboard_stats";
import deactivateFreeWebinar from "@/lib/crm-tools/tools/deactivate_free_webinar";
import draftConversationReply from "@/lib/crm-tools/tools/draft_conversation_reply";
import getContact from "@/lib/crm-tools/tools/get_contact";
import getConversation from "@/lib/crm-tools/tools/get_conversation";
import getEnrollment from "@/lib/crm-tools/tools/get_enrollment";
import getFreeWebinar from "@/lib/crm-tools/tools/get_free_webinar";
import getPayment from "@/lib/crm-tools/tools/get_payment";
import getWorkshopEdition from "@/lib/crm-tools/tools/get_workshop_edition";
import importGoogleContact from "@/lib/crm-tools/tools/import_google_contact";
import linkConversationToContact from "@/lib/crm-tools/tools/link_conversation_to_contact";
import listAiRuns from "@/lib/crm-tools/tools/list_ai_runs";
import listAppointments from "@/lib/crm-tools/tools/list_appointments";
import listCalendarEvents from "@/lib/crm-tools/tools/list_calendar_events";
import listConversations from "@/lib/crm-tools/tools/list_conversations";
import listEnrollments from "@/lib/crm-tools/tools/list_enrollments";
import listFreeEventRegistrations from "@/lib/crm-tools/tools/list_free_event_registrations";
import listGoogleAccounts from "@/lib/crm-tools/tools/list_google_accounts";
import listMessageTemplates from "@/lib/crm-tools/tools/list_message_templates";
import listNotifications from "@/lib/crm-tools/tools/list_notifications";
import listPaymentReceipts from "@/lib/crm-tools/tools/list_payment_receipts";
import listPayments from "@/lib/crm-tools/tools/list_payments";
import listProducts from "@/lib/crm-tools/tools/list_products";
import listWhatsappMessages from "@/lib/crm-tools/tools/list_whatsapp_messages";
import listWorkshopDocuments from "@/lib/crm-tools/tools/list_workshop_documents";
import listWorkshopEditions from "@/lib/crm-tools/tools/list_workshop_editions";
import listWorkshopEnrollees from "@/lib/crm-tools/tools/list_workshop_enrollees";
import pendingTasks from "@/lib/crm-tools/tools/pending_tasks";
import prepareCustomerWhatsappMessage from "@/lib/crm-tools/tools/prepare_customer_whatsapp_message";
import queryAuditLog from "@/lib/crm-tools/tools/query_audit_log";
import recordManualPayment from "@/lib/crm-tools/tools/record_manual_payment";
import requestPaymentOtp from "@/lib/crm-tools/tools/request_payment_otp";
import searchContacts from "@/lib/crm-tools/tools/search_contacts";
import searchGoogleContacts from "@/lib/crm-tools/tools/search_google_contacts";
import sendBulkEmail from "@/lib/crm-tools/tools/send_bulk_email";
import sendContactEmail from "@/lib/crm-tools/tools/send_contact_email";
import sendContactSms from "@/lib/crm-tools/tools/send_contact_sms";
import sendContactTemplateEmail from "@/lib/crm-tools/tools/send_contact_template_email";
import sendWhatsappBulk from "@/lib/crm-tools/tools/send_whatsapp_bulk";
import sendWhatsappToContact from "@/lib/crm-tools/tools/send_whatsapp_to_contact";
import updateCalendarEvent from "@/lib/crm-tools/tools/update_calendar_event";
import updateFreeWebinar from "@/lib/crm-tools/tools/update_free_webinar";
import updateProductPrice from "@/lib/crm-tools/tools/update_product_price";
import updatePromoCode from "@/lib/crm-tools/tools/update_promo_code";
import updateUsdToCopRate from "@/lib/crm-tools/tools/update_usd_to_cop_rate";
import updateWorkshop from "@/lib/crm-tools/tools/update_workshop";
import uploadDriveFile from "@/lib/crm-tools/tools/upload_drive_file";
import whatsappAiStatus from "@/lib/crm-tools/tools/whatsapp_ai_status";
import whatsappFindChat from "@/lib/crm-tools/tools/whatsapp_find_chat";
import whatsappGetConfig from "@/lib/crm-tools/tools/whatsapp_get_config";
import whatsappListPlaybooks from "@/lib/crm-tools/tools/whatsapp_list_playbooks";
import whatsappSavePlaybook from "@/lib/crm-tools/tools/whatsapp_save_playbook";
import whatsappSetChat from "@/lib/crm-tools/tools/whatsapp_set_chat";
import whatsappSimulateReply from "@/lib/crm-tools/tools/whatsapp_simulate_reply";
import whatsappUpdateConfig from "@/lib/crm-tools/tools/whatsapp_update_config";

/**
 * Every CRM tool definition by name, served by the MCP server (`lib/mcp/`).
 * `satisfies` makes the catalog (`catalog.ts`) and this map fail typecheck
 * the moment they disagree.
 */
export const TOOL_DEFINITIONS = {
  booking_set_day_hours: bookingSetDayHours,
  convert_event_timezone: convertEventTimezone,
  create_calendar_event: createCalendarEvent,
  create_contact: createContact,
  create_promo_code: createPromoCode,
  create_staff_user: createStaffUser,
  create_therapy_enrollment: createTherapyEnrollment,
  create_workshop: createWorkshop,
  create_workshop_product: createWorkshopProduct,
  crm_stats: crmStats,
  dashboard_stats: dashboardStats,
  deactivate_free_webinar: deactivateFreeWebinar,
  draft_conversation_reply: draftConversationReply,
  get_contact: getContact,
  get_conversation: getConversation,
  get_enrollment: getEnrollment,
  get_free_webinar: getFreeWebinar,
  get_payment: getPayment,
  get_workshop_edition: getWorkshopEdition,
  import_google_contact: importGoogleContact,
  link_conversation_to_contact: linkConversationToContact,
  list_ai_runs: listAiRuns,
  list_appointments: listAppointments,
  list_calendar_events: listCalendarEvents,
  list_conversations: listConversations,
  list_enrollments: listEnrollments,
  list_free_event_registrations: listFreeEventRegistrations,
  list_google_accounts: listGoogleAccounts,
  list_message_templates: listMessageTemplates,
  list_notifications: listNotifications,
  list_payment_receipts: listPaymentReceipts,
  list_payments: listPayments,
  list_products: listProducts,
  list_whatsapp_messages: listWhatsappMessages,
  list_workshop_documents: listWorkshopDocuments,
  list_workshop_editions: listWorkshopEditions,
  list_workshop_enrollees: listWorkshopEnrollees,
  pending_tasks: pendingTasks,
  prepare_customer_whatsapp_message: prepareCustomerWhatsappMessage,
  query_audit_log: queryAuditLog,
  record_manual_payment: recordManualPayment,
  request_payment_otp: requestPaymentOtp,
  search_contacts: searchContacts,
  search_google_contacts: searchGoogleContacts,
  send_bulk_email: sendBulkEmail,
  send_contact_email: sendContactEmail,
  send_contact_sms: sendContactSms,
  send_contact_template_email: sendContactTemplateEmail,
  send_whatsapp_bulk: sendWhatsappBulk,
  send_whatsapp_to_contact: sendWhatsappToContact,
  update_calendar_event: updateCalendarEvent,
  update_free_webinar: updateFreeWebinar,
  update_product_price: updateProductPrice,
  update_promo_code: updatePromoCode,
  update_usd_to_cop_rate: updateUsdToCopRate,
  update_workshop: updateWorkshop,
  upload_drive_file: uploadDriveFile,
  whatsapp_ai_status: whatsappAiStatus,
  whatsapp_find_chat: whatsappFindChat,
  whatsapp_get_config: whatsappGetConfig,
  whatsapp_list_playbooks: whatsappListPlaybooks,
  whatsapp_save_playbook: whatsappSavePlaybook,
  whatsapp_set_chat: whatsappSetChat,
  whatsapp_simulate_reply: whatsappSimulateReply,
  whatsapp_update_config: whatsappUpdateConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<ToolName, ToolDefinition<any, any>>;

/**
 * One definition with its input type erased. The map above is a union of 65
 * input shapes; code that handles any tool by name (the MCP server, the e2e
 * scripts) only passes inputs through, and each tool validates its own.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolDefinition = (name: ToolName): ToolDefinition<any, any> => TOOL_DEFINITIONS[name];
