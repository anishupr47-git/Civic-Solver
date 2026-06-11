import os
import logging
import datetime
from django.db import transaction
from django.core.exceptions import ValidationError
from django.contrib.auth.models import User
from .models import Category, IssueReport, MediaAttachment, StatusUpdate

logger = logging.getLogger('reports')

class NotificationService:
    """
    Decoupled notification dispatch platform for sending cellular SMS notifications,
    municipal email dispatches, and event based web-hooking
    """
    @staticmethod
    def dispatch_issue_alerts(report: IssueReport):
        """Notifies Municipalities"""
        priority = "HIGH" if (report.automated_priority_override or report.category.priority == "High") else report.category.priority.upper()

        logger.info(
            f"[NOTIFICATION SERVICE] Processing dispatch alerts for Issue {report.ticket_number} (Priority: {priority})"
        )

        #1 Mock Dispatching Cellular Webhook
        payload = {
            "ticket_number": report.ticket_number,
            "priority": priority,
            "assignment_group": report.category.assignment_group,
            "message": f"CRITICAL INCIDENT ALERT: {report.title} reported at coordinates ({report.latitude}, {report.longitude})"
        }
        logger.info(f"[SMS WEBHOOK] Fired Webhook to municipal response networks successfully with: {payload}")

        #2Mock Email to Civic Dispatch Networks
        email_recipient = f"dispatch.{report.category.assignment_group.lower().replace(' ', '_')}@metropolis.gov"
        email_body = (
            f"Subject: [INCIDENT REPORT] {report.ticket_number}-{priority} priority\n"
            f"Attention: {report.category.assignment_group}\n\n"
            f"A civic report was logged in the system with title: '{report.title}'\n"
            f"Description: {report.description}\n"
            f"Location: Lat {report.latitude}, Lon {report.longitude}\n"
            f"Reported At: {report.created_at}\n\n"
            f"Municipal action is requested. Please Investigate nicely"
        )
        logger.info(f"[EMAIL SERVICE] Alert dispatched successfully to: {email_recipient}\n{email_body}")

        #3 Log Audit Traces in municipal monitoring database
        logger.info(
            f"[SYSTEM AUDIT] Ticket {report.ticket_number} successfully registered. System dispatched notifications"
            f"to department: {report.category.assignment_group}"
        )

class ReportProcessingService:
    """
    Core business processor oerchestrating transactional safety validations, geospatial bounding controls.
    """
    #Bounding paramteres for our mock city "Metropolis"
    METROPOLIS_BOUNDS = {
        'LAT_MIN': 40.7000,
        'LAT_MAX': 40.8500,
        'LON_MIN': -74.0500,
        'LON_MAX': -73.8500
    }

    @classmethod
    def validate_geospatial_bounds(cls, latitude: float, longitude: float):
        """
        Verifies that coordinates are strictly within "Metropolis" municipal borders.
        """
        logger.debug(f"Verifying geospatial bounds for coordinates: Lat={latitude}, Lon={longitude}")

        lat_min = cls.METROPOLIS_BOUNDS['LAT_MIN']
        lat_max = cls.METROPOLIS_BOUNDS['LAT_MAX']
        lon_min = cls.METROPOLIS_BOUNDS['LON_MIN']
        lon_max= cls.METROPOLIS_BOUNDS['LON_MAX']

        if not (lat_min <= latitude <= lat_max):
            logger.warning(f"Latitude {latitude} falls outside Metropolis municipal boundary [{lat_min}, {lat_max}]")
            raise ValidationError(f"Coordinates fall outside Metropolis borders. Latitude must be between {lat_min} and {lat_max}")

        if not (lon_min <= longitude <= lon_max):
            logger.warning(f"Longitude {longitude} falls outside Metropolis municipal boundary [{lon_min}, {lon_max}]")
            raise ValidationError(f"Coordinates fall outside Metropolis borders. Longitude must be between {lon_min} and {lon_max}")
        
        logger.info("Coordinates successfully validated within Metropolis municipal boundaries")

    @classmethod
    def check_recent_duplicates(cls, latitude: float, longitude:float, category_id: int, radius_degrees: float = 0.0015):
        """
        Checks for matching active tickets within the range and beyond that too
        If a duplicated is found, the system increases the existing ticket
        """
        time_threshold = datetime.datetime.now() - datetime.timedelta(hours=48)

        logger.debug(
            f"Deduplication engine searching for reports in category {category_id} since {time_threshold}"
            f"within radius {radius_degrees} around ({latitude}, {longitude})"
        )

        active_statuses = ['Open', 'Investigating', 'Scheduled', 'In Progress']

        #Boundin box for efficient database queries
        lat_min = latitude - radius_degrees
        lat_max = latitude + radius_degrees
        lon_min = longitude - radius_degrees
        lon_max = longitude + radius_degrees

        recent_reports = IssueReport.objects.filter(
            category_id=category_id,
            status__in=active_statuses,
            created_at__gte=time_threshold,
            latitude__range=(lat_min, lat_max),
            longitude__range=(lon_min, lon_max)
        )

        if recent_reports.exists():
            duplicate = recent_reports.first()
            logger.info(
                f"[DEDUPLICATION] Matching duplicate incident discovered: {duplicate.ticket_number}"
                f"Automatically appending tracking count"
            )

            with transaction.atomic():
                #Re-fetch with select_for_update to avoid race conditions
                locked_report = IssueReport.objects.select_for_update().get(pk=duplicate.pk)
                locked_report.upvote_count +=1
                locked_report.save(update_fields=['upvote_count', 'updated_at'])

                #Append a status history record indicating user validation
                StatusUpdate.objects.create(
                    report=locked_report,
                    previous_status=locked_report.status,
                    new_status=locked_report.status,
                    comment="System Aggregated duplicate citizen report into this tracking ticket",
                    administrative_notes="Deduplication engine matched ticket coordinates and upvoted the parent issue"
                )

            return {
                "is_duplicate": True,
                "report_instance": locked_report,
                "message": f"Duplicate report detected withing coordinates. Automatically logged upvote for ticket {locked_report.ticket_number}"
            }
        
        logger.debug("[DEDUPLICATION] No matching duplicate ticket found. Proceeding with creation pipeline")
        return {"is_duplicate":False}
    
    @classmethod
    def calculate_ai_urgency_override(cls,title:str, description: str):
        """
        Automated classification assistant that scans text strings for high-risk words
        """
        combined_text = (title + " " + description).lower()

        high_risk_triggers = [
            "gas leak",
            "bleeding",
            "collapsed",
            "sinkhole",
            "explosion",
            "sparking",
            "toxic",
            "flooding",
            "downed wire",
            "broken main",
            "live power",
            "hazardous waste"
        ]

        logger.debug("AI classifier scanning report fields for urgent risk parameters")

        triggered_keywords = [word for word in high_risk_triggers if word in combined_text]

        if triggered_keywords:
            logger.info(
                f"[AI CLASSIFIER] High-risk keyword detected: {triggered_keywords}"
                f"Elevating report attributes to high priority override"
            )
            return True
        
        return False
    
    @classmethod
    def create_issue_reports(cls, title:str, description: str, category_id:int, latitude:float, longitude: float,
                             anonymous_reporter_hash: str, files=None, reported_by=None):
        """
        Exhausive creation pipeline context executing under database transaction blocks
        Ensures full formatting and security
        """
        logger.info(f"Initiating transaction creation pipeline for new report: `{title}`")

        #1. Coordinate Validation
        cls.validate_geospatial_bounds(latitude, longitude)

        #2. Spatial Deduplication Checks
        dup_check = cls.check_recent_duplicates(latitude, longitude, category_id)
        if dup_check["is_duplicate"]:
            #Returns diagnostic state to view layer immediately without raising error
            return dup_check["report_instance"], True
        
        #3. Fetch Category to determine defaults
        try:
            category = Category.objects.get(pk=category_id)
        except Category.DoesNotExist:
            logger.error(f"Category ID {category_id} is not found in database")
            raise ValidationError(f"Category selection with ID {category_id} does not exist")
        
        #4 Runn automated priority analysis
        ai_override = cls.calculate_ai_urgency_override(title, description)

        #5 Database Save Operations wrapped in atomic context
        with transaction.atomic():
            report = IssueReport(
                title=title.strip(),
                description=description.strip(),
                category=category,
                latitude=latitude,
                longitude=longitude,
                automated_priority_override=ai_override,
                reported_by=reported_by,
                anonymous_reporter_hash=anonymous_reporter_hash,
                upvote_count=1 #Setting starting upvote count
            )
            report.save()

            #Record Initial history log
            StatusUpdate.objects.create(
                report=report,
                previous_status='Open',
                new_status='Open',
                comment="Civic reports initialized and registered within municipal archives",
                administrative_notes=f"AI priority status computed. Override trigger status: {ai_override}"
            )


            #Process evidence files if attachments exist
            if files:
                logger.info(f"Processing and validating {len(files)} uploaded files")
                for uploaded_file in files:
                    #Validate file extension / headers safely
                    file_name = uploaded_file.name
                    file_size = uploaded_file.size
                    mime_type = uploaded_file.content_type or 'image/jpeg'

                    #Ensure size constraints
                    if file_size > 5 * 1024 * 1024:
                        logger.warning(f"File {file_name} rejected: size ({file_size}B)exceeds 5MB limits ")
                        raise ValidationError("Upload attachment size cannot exceed 5MB")
                    
                    #Create MediaAttachment record
                    media = MediaAttachment(
                        report=report,
                        file_path=uploaded_file,
                        file_size=file_size,
                        mime_type=mime_type
                    )
                    media.save()
                    logger.debug(f"Evidence attachment saved: {media.file_path} for Ticket {report.ticket_number}")

        #POST-COMMIT ALERTS
        try:
            NotificationService.dispatch_issue_alerts(report)
        except Exception as alert_err:
            #We log and capture errors but do not crash creation process
            logger.error(f"[NOTFICIATION FAILURE] Failed to dispatch alerts for {report.ticket_number}: {alert_err}")

        return report, False
    
    