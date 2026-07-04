from django.db import models
import uuid
import datetime
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError

class Category(models.Model):
    """Category model"""
    PRIORITY_CHOICES = [
        ('Low', 'Small worry'),
        ('Medium', 'Medium worry'),
        ('High', 'Big worry'),
    ]

    ASSIGNMENT_GROUP_CHOICES = [
        ('Public Works', 'Road fixers'),
        ('Animal Control', 'Animal helpers'),
        ('Traffic Safety', 'Street lights'),
        ('Sanitation', 'Trash cleaners'),
    ]

    name = models.CharField(max_length=100, verbose_name="Category Name")
    system_slug= models.SlugField(max_length=100, unique=True, verbose_name="System Slug")
    priority= models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='Low', verbose_name="Default Priority")
    assignment_group = models.CharField(max_length=50, choices=ASSIGNMENT_GROUP_CHOICES, default='Public Work', verbose_name='Responsibe Municipal Group')
    description= models.TextField(blank=True, verbose_name="Detailed Group Description")

    class Meta:
        verbose_name = "Civic Issue Category"
        verbose_name_plural = "Civic Issue Category"
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.get_priority_display()} - {self.get_assignment_group_display()})"
    

class IssueReport(models.Model):
    """Report model"""

    STATUS_CHOICES = [
        ('Open', 'We got it'),
        ('Investigating', 'Looking at it'),
        ('Scheduled', 'Planned to fix'),
        ('In Progress', 'Fixing it now'),
        ('Resolved', 'All fixed and done'),
        ('Rejected', 'Not needed'),
    ]

    ticket_number= models.CharField(max_length=20,unique=True,editable=False,verbose_name="Ticket Tracking Identifier")
    title= models.CharField(max_length=150, verbose_name="Issue Title Summary")
    description = models.TextField(verbose_name="Detailed Issue Description")
    category = models.ForeignKey(Category,on_delete=models.PROTECT, related_name="reports", verbose_name="Issue Classification")
    latitude = models.FloatField(verbose_name="Geospatial Longitude")
    longitude = models.FloatField(verbose_name="Geospatial Longitude")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Open", verbose_name="Remediation Status")
    automated_priority_override = models.BooleanField(default=False, verbose_name="AI Priority Override Elevated")
    reported_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="submitted_issues", verbose_name="Reporting Citizen")
    anonymous_reporter_hash = models.CharField(max_length=64, verbose_name="Anoymized Signature Hash")
    upvote_count = models.IntegerField(default=0,verbose_name="Upvote Verification Count")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Created At")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Updated At")

    class Meta:
        verbose_name="Civic Issue Report"
        verbose_name_plural= "Civic Issue Reports"
        ordering = ['created_at']

    def __str__(self):
        return f"{self.ticket_number} - {self.title} [{self.get_status_display()}]"
    
    def clean(self):
        """Check coordinates"""
        if not (-90.0 <= self.latitude <= 90.0):
            raise ValidationError({'latitude':'Latitude must sit withing [-90.0, 90.0] limits '})
        if not (-180.0 <= self.longitude <=180.0):
            raise ValidationError({'longitude':'Longitude must sit within [-180.0, 180.0] limits'})
        
    def save(self, *args, **kwargs):
        """Save report"""
        self.clean()
        if not self.ticket_number:
            now= datetime.datetime.now()
            year= now.year
            #Get ticket index for this year
            yearly_count = IssueReport.objects.filter(created_at__year=year).count()+1
            ticket_candidate = f"CIV-{year}-{yearly_count:05d}"
            #Check collisions
            while IssueReport.objects.filter(ticket_number=ticket_candidate).exists():
                yearly_count +=1
                ticket_candidate =f"CIV-{year}-{yearly_count:05d}"
            self.ticket_number=ticket_candidate
        super().save(*args, **kwargs)

class StatusUpdate(models.Model):
    """Status log model"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4,editable=False)
    report = models.ForeignKey(IssueReport,on_delete=models.CASCADE,related_name="history_logs",verbose_name="Linked Issue Ticket")
    previous_status = models.CharField(max_length=20, choices=IssueReport.STATUS_CHOICES, verbose_name="Previous State")
    new_status = models.CharField(max_length=20, choices=IssueReport.STATUS_CHOICES, verbose_name="New State")
    comment = models.TextField(blank=True, verbose_name="Citizen Comment")
    administrative_notes = models.TextField(blank=True, verbose_name="Municipal Admin Comment")
    created_at = models.DateField(auto_now_add=True, verbose_name="Created At")

    class Meta:
        verbose_name = "Ticket Status Log"
        verbose_name_plural = "Ticket Status Logs"
        ordering = ['created_at']

    def __str__(self):
        return f"Transition {self.report.ticket_number}: {self.previous_status} -> {self.new_status} at {self.created_at}"
    

def get_attachment_upload_path(instance, filename):
    """Get upload path"""
    ext = filename.split('.')[-1]
    name = uuid.uuid4().hex
    return f"reports/{instance.report.ticket_number}/{name}.{ext}"


class MediaAttachment(models.Model):
    """Media model"""

    id=models.UUIDField(primary_key=True,default=uuid.uuid4,editable=False)
    report = models.ForeignKey(IssueReport,on_delete=models.CASCADE,related_name="media_attachments",verbose_name="Associated Ticket")
    file_path = models.ImageField(upload_to=get_attachment_upload_path, verbose_name="Uploaded Evidance Image")
    file_size = models.IntegerField(default=0, verbose_name="Assest Size in Bytes")
    mime_type = models.CharField(max_length=100, verbose_name="File Mime Type")
    uploaded_at = models.DateTimeField(auto_now_add=True, verbose_name="Uploaded At")

    class Meta:
        verbose_name ="Media Evidence Attachment"
        verbose_name_plural = "Media Evidence Attachments"
        ordering = ['uploaded_at']

    def __str__(self):
        return f"Attachment {self.id} (Size: {self.file_size}B) linked to {self.report.ticket_number}"
