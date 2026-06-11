# Civic-Solver
Welcome to my very cool app! It is called **Civic Solver**. 
This app is like a big helper friend for a city called Metropolis.(later api's can be added to project your city or the entire map itself)
Sometimes, things in the city get broken. There might be a big hole in the road, or a trash can is too full, or a street light stops shining. 
When that happens, people can use this app to tell the city workers: *"Hey fix this please *



##  The Tech Stack 

Our app has two big parts that talk to each other like two walkie-talkies.

### 1. The Frontend 
The frontend is the part of the app that you can see on your screen. It has pretty colors and clicky buttons!
* **React**: This is like magic Lego blocks. We use it to build all the pages and buttons so they look nice and move smoothly when you click them.
* **Vite**: This is a super-fast rocket ship. It helps the developer run the app very quickly while making it.
* **SVG Map**: Instead of using heavy, slow maps, we drew our own city map using digital lines. You can zoom in, zoom out, and move it around with your mouse!
* **Vanilla CSS**: This is like the crayons and paint. We used it to make the app look dark and cool, with glowing lights and smooth animations.

### 2. The Backend 
The backend is the part of the app that you cannot see. It works behind the scenes to remember things and keep us safe.
* **Python and Django**: This is the big robot brain. It reads the messages we send and makes sure they follow the rules.
* **Django REST Framework**: This is the bridge that lets the frontend talk to the backend.
* **SQLite**: This is like a tiny, smart notebook. Every time someone reports a problem, the robot writes it down in this notebook so it never forgets!
* **Pillow**: No, not the pillow you sleep on! This is a Python tool that helps our database look at and store pictures of the broken things.



##  Super Cool Features

Here is a list of all the fun things our app can do:

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
