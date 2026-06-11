import time
import hashlib
import logging
import threading
from django.http import JsonResponse

logger = logging.getLogger('reports')

class RateLimitAndAnonymizationMiddleware:
    """
    Safe django guard-rail
    """
    def __init__(self,get_response):
        self.get_response = get_response
        #Dictionary structure
        self.write_request_logs = {}
        self.general_request_logs = {}
        self.lock = threading.Lock()

        #LIMITS CONFIGURATION
        self.WRITE_LIMIT = 6
        self.GENERAL_LIMIT = 100
        self.WINDOW_SIZE = 60

    def _get_client_ip(self, request):
        """Extracts the true client IP, handling proxies correctly"""
        # Cloudflare
        cf_connecting_ip = request.META.get('HTTP_CF_CONNECTING_IP')
        if cf_connecting_ip:
            return cf_connecting_ip.strip()

        # Standard real IP headers
        x_real_ip = request.META.get('HTTP_X_REAL_IP')
        if x_real_ip:
            return x_real_ip.strip()

        # Forwarded-For proxy chain
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            return x_forwarded_for.split(',')[0].strip()

        # Fallback
        return request.META.get('REMOTE_ADDR', '127.0.0.1')

    
    def _calculate_reporter_hash(self, ip, user_agent):
        """Computes a signature of IP and user agent to track"""
        data = f"{ip}:{user_agent}:CIVIC_SALT_98745".encode('utf-8')
        return hashlib.sha256(data).hexdigest()
    
    def _is_rate_limited(self, log_dict, signature, limit_threshold):
        """
        Thread-safe check to check
        """
        now = time.time()
        cutoff = now - self.WINDOW_SIZE

        with self.lock:
            #Initialize log list if not present
            if signature not in log_dict:
                log_dict[signature] = []

            #Prune old logs outside the current window
            log_dict[signature] = [t for t in log_dict[signature] if t > cutoff]

            history = log_dict[signature]
            current_count = len(history)

            if current_count >= limit_threshold:
                if current_count > 0:
                    oldest_timestamp = history[0]
                    reset_time = max(0, int(self.WINDOW_SIZE - (now - oldest_timestamp)))
                else:
                    reset_time = 0
                logger.warning(f"[RATE LIMIT] Client signature {signature[:8]} exceeded limits ({current_count}/{limit_threshold})")
                return True, 0, reset_time

            # Record the current request timestamp
            log_dict[signature].append(now)
            new_count = current_count + 1
            remaining = max(0, limit_threshold - new_count)

            oldest_timestamp = log_dict[signature][0]
            reset_time = max(0, int(self.WINDOW_SIZE - (now - oldest_timestamp)))

            return False, remaining, reset_time
            
    def __call__(self, request):
        # Skip rate-limiting and anonymization for Django Admin paths
        if 'admin' in request.path:
            return self.get_response(request)

        # we only rate limit and anonymize calls hitting /api/
        if not request.path.startswith('/api/'):
            return self.get_response(request)

        

        #1 capture client ip and user agent
        client_ip = self._get_client_ip(request)
        user_agent = request.META.get('HTTP_USER_AGENT', 'unknown_agent')

        #2 Compute privacy 
        anonymized_signature = self._calculate_reporter_hash(client_ip, user_agent)

        #Inject the signature
        request.META['ANONYMOUS_REPORTER_HASH'] = anonymized_signature
        request.META['HTTP_X_CLIENT_SIGNATURE'] = anonymized_signature

        #3 Apply sliding window rate limiting checks
        is_write = request.method in ['POST', 'PUT', 'PATCH', 'DELETE']

        #select target limits
        if is_write:
            limited, remaining, reset_in = self._is_rate_limited(
                self.write_request_logs, anonymized_signature, self.WRITE_LIMIT
            )
            limit_max = self.WRITE_LIMIT
        else:
            limited, remaining, reset_in = self._is_rate_limited(
                self.general_request_logs, anonymized_signature, self.GENERAL_LIMIT
            )
            limit_max = self.GENERAL_LIMIT

        #IF RATE LIMITED
        if limited:
            response=JsonResponse({
                "error": "Rate limit exceeded. Too Many Requests",
                "messgae": f"You have reached system allowance threshold. Retry again in {reset_in} seconds"
            }, status=429)

            response['X-Rate-Limit-Remaining']='0'
            response['X-Rate-Limit-Reset']=str(reset_in)
            response['X-Client-Signature']= anonymized_signature
            response['X-Civic-Anonymized']= 'True'
            return response
        
        #4 privacy
        if 'HTTP_COOKIE' in request.META:
            #filter out sensative cookies
            logger.debug("Scrubbing incoming HTTP cookies for client anonymity")
            del request.META['HTTP_COOKIE']

        #execute downstream pipeline
        response = self.get_response(request)

        #5 Inject cryptographic security
        response['X-Client-Signature']= anonymized_signature
        response['X-Civic-Anonymized']= 'True'
        response['X-Rate-Limit-Remaining']= str(remaining)
        response['X-Rate-Limit-Reset']= str(reset_in)

        return response
