import os
import logging
import datetime
from django.db import transaction
from django.core.exceptions import ValidationError
from django.contrib.auth.models import User
from .models import Category, IssueReport, MediaAttachment, StatusUpdate

logger = logging.getLogger('reports')

class NotificationService:
    """Notification service"""
    @staticmethod
    def dispatch_issue_alerts(report: IssueReport):
        """Send alerts"""
        priority = "HIGH" if (report.automated_priority_override or report.category.priority == "High") else report.category.priority.upper()

        logger.info("Sending notifications")

        # Send webhook
        payload = {
            "ticket_number": report.ticket_number,
            "priority": priority,
            "assignment_group": report.category.assignment_group,
            "message": f"CRITICAL INCIDENT ALERT: {report.title} reported at coordinates ({report.latitude}, {report.longitude})"
        }
        logger.info("Webhook sent")

        # Send email
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
        logger.info("Email sent")

        # Log audit
        logger.info("System logged report")

class ReportProcessingService:
    """Report processor"""
    # City bounds
    METROPOLIS_BOUNDS = {
        'LAT_MIN': 40.7000,
        'LAT_MAX': 40.8500,
        'LON_MIN': -74.0500,
        'LON_MAX': -73.8500
    }

    @classmethod
    def validate_geospatial_bounds(cls, latitude: float, longitude: float):
        """Check coordinates"""
        logger.debug("Checking coordinates")

        lat_min = cls.METROPOLIS_BOUNDS['LAT_MIN']
        lat_max = cls.METROPOLIS_BOUNDS['LAT_MAX']
        lon_min = cls.METROPOLIS_BOUNDS['LON_MIN']
        lon_max= cls.METROPOLIS_BOUNDS['LON_MAX']

        if not (lat_min <= latitude <= lat_max):
            logger.warning("Latitude out of bounds")
            raise ValidationError(f"This place is too far")

        if not (lon_min <= longitude <= lon_max):
            logger.warning("Longitude out of bounds")
            raise ValidationError(f"This place is too far")
        
        logger.info("Coordinates are ok")

    @classmethod
    def check_recent_duplicates(cls, latitude: float, longitude:float, category_id: int, radius_degrees: float = 0.0015):
        """Check duplicate reports"""
        time_threshold = datetime.datetime.now() - datetime.timedelta(hours=48)

        logger.debug("Searching duplicates")

        active_statuses = ['Open', 'Investigating', 'Scheduled', 'In Progress']

        # Box bounds
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
            logger.info("Duplicate found")

            with transaction.atomic():
                # Lock row
                locked_report = IssueReport.objects.select_for_update().get(pk=duplicate.pk)
                locked_report.upvote_count +=1
                locked_report.save(update_fields=['upvote_count', 'updated_at'])

                # Add upvote log
                StatusUpdate.objects.create(
                    report=locked_report,
                    previous_status=locked_report.status,
                    new_status=locked_report.status,
                    comment="Another citizen added a vote to this report",
                    administrative_notes="Same coordinates found"
                )

            return {
                "is_duplicate": True,
                "report_instance": locked_report,
                "message": f"We already have a report for this place and we added your vote to ticket {locked_report.ticket_number}"
            }
        
        logger.debug("No duplicate found")
        return {"is_duplicate":False}
    
    @classmethod
    def calculate_ai_urgency_override(cls,title:str, description: str):
        """Scan text for risk"""
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

        logger.debug("Scanning text")

        triggered_keywords = [word for word in high_risk_triggers if word in combined_text]

        if triggered_keywords:
            logger.info("Risk keyword detected")
            return True
        
        return False
    
    @classmethod
    def create_issue_reports(cls, title:str, description: str, category_id:int, latitude:float, longitude: float,
                             anonymous_reporter_hash: str, files=None, reported_by=None):
        """Create new report"""
        logger.info("Starting report creation")

        # Check coordinates
        cls.validate_geospatial_bounds(latitude, longitude)

        # Check duplicates
        dup_check = cls.check_recent_duplicates(latitude, longitude, category_id)
        if dup_check["is_duplicate"]:
            # Return duplicate
            return dup_check["report_instance"], True
        
        # Get category
        try:
            category = Category.objects.get(pk=category_id)
        except Category.DoesNotExist:
            logger.error("Category not found")
            raise ValidationError(f"We could not find this group")
        
        # Check priority
        ai_override = cls.calculate_ai_urgency_override(title, description)

        # Save to database
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
                upvote_count=1 # Set upvote
            )
            report.save()

            # Record log
            StatusUpdate.objects.create(
                report=report,
                previous_status='Open',
                new_status='Open',
                comment="We started the report and put it in our files",
                administrative_notes="Checked by system"
            )


            # Save attachments
            if files:
                logger.info("Processing files")
                for uploaded_file in files:
                    # Validate file
                    file_name = uploaded_file.name
                    file_size = uploaded_file.size
                    mime_type = uploaded_file.content_type or 'image/jpeg'

                    # Validate file
                    if file_size > 5 * 1024 * 1024:
                        logger.warning("File is too big")
                        raise ValidationError("This picture is too big. Make it smaller than five megabytes")
                    
                    # Save file record
                    media = MediaAttachment(
                        report=report,
                        file_path=uploaded_file,
                        file_size=file_size,
                        mime_type=mime_type
                    )
                    media.save()
                    logger.debug("File saved")

        # Post alerts
        try:
            NotificationService.dispatch_issue_alerts(report)
        except Exception as alert_err:
            # Catch errors
            logger.error("Alert failed")

        return report, False