# Civic-Solver
Welcome to my very cool app! It is called **Civic Solver**. 
This app is like a big helper friend for a city called Metropolis.(later api's can be added to project your city or the entire map itself)
Sometimes, things in the city get broken. There might be a big hole in the road, or a trash can is too full, or a street light stops shining. 
When that happens, people can use this app to tell the city workers: *"Hey fix this please *



##  The Tech Stack 

Our app has two big parts that talk to each other like two walkie-talkies.

### 1. The Frontend 

* **React**: 
* **Vite**: 
* **SVG Map**: 
* **Vanilla CSS**: 

### 2. The Backend 

* **Python and Django**: 
* **Django REST Framework**: 
* **SQLite**: 
* **Pillow**



##  Super Cool Features

Here is a list of all the fun things my app can do:

###  The Interactive City Map
* You can look at a big map of the city. 
* There are little glowing dots on the map. The dots show where things are broken!
* Red dots mean **"Oh no, this is super dangerous!"** like a wire falling down.
* Yellow and blue dots mean **"Please fix this soon,"** like a bumpy road.
* You can click anywhere on the map to get the map numbers (coordinates) for a new report.

###  Reporting Problems
You can make a new report to help the city! You can choose from these categories:
*  **Potholes & Road Damage**: For bumpy roads and broken sidewalks.
*  **Animal Control**: For strays or noisy animals.
*  **Traffic Signals & Markings**: For broken traffic lights and stop signs.
*  **Sanitation & Trash**: For messy trash dumps and dirty streets.
*  **Hazardous Gas & Power Outages**: For scary things like gas smells or broken power lines.

###  The Secret Security Guard (Anonymizer)
* Our app has a super secret code that scrubs away your name and private computer details.
* It makes sure nobody knows who reported the issue so you stay safe!
* It also has a **Rate Limiter**. This is like a teacher saying, *"You can only ask 6 questions a minute!"* It stops naughty computers from spamming the system with too many fake reports.

###  The Upvote Power
* If you see a problem on the map that you also care about, you can click the **Upvote** button!
* The more people click upvote, the bigger the number gets. This tells the city: *"Wow, many people want this fixed right now!"*

###  The Admin Panel (For the Bosses)
* City workers can log in to a special boss screen.
* They can look at the reports and change the status.
* They can change a report from **"New"** to **"Investigating"** (looking at it) and then to **"Resolved"** (all fixed!).
