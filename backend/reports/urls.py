from django.urls import path
from .views import(
    CategoryListAPIView,
    IssueReportListCreateAPIView,
    IssueReportDetailAPIView,
    IssueReportUpvoteAPIView
)
app_name = 'reports'

urlpatterns = [
    path('categories/', CategoryListAPIView.as_view(), name='category-list'),

    path('reports/', IssueReportListCreateAPIView.as_view(), name='report-list-create'),
    path('reports/<int:pk>/', IssueReportDetailAPIView.as_view(), name='report-detail'),
    path('reports/<int:pk>/upvote/', IssueReportUpvoteAPIView.as_view(), name='report-upvote'),
]