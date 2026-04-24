main.floors.M5=
{
    "floorId": "M5",
    "title": "心境 M5",
    "name": "心境 M5",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 10000000000000,
    "defaultGround": 1895,
    "bgm": "40.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "6,1": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "11,11": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "1,5": [
            {
                "type": "setValue",
                "name": "flag:door_M5_2_4",
                "operator": "+=",
                "value": "1"
            }
        ],
        "3,5": [
            {
                "type": "setValue",
                "name": "flag:door_M5_2_4",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "2,4": {
            "0": {
                "condition": "flag:door_M5_2_4==2",
                "currentFloor": true,
                "priority": 0,
                "delayExecute": false,
                "multiExecute": false,
                "data": [
                    {
                        "type": "openDoor"
                    },
                    {
                        "type": "setValue",
                        "name": "flag:door_M5_2_4",
                        "operator": "=",
                        "value": "null"
                    }
                ]
            }
        }
    },
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [  4,  4,  4,  4,  4,1886,1886,1886,1886,1886,1886,1886,1886],
    [  4,1014,  0,644,  4,  0, 88, 16,  0,1886,1012, 23,1886],
    [  4,  0,1763,  0, 83,1961,  0,1886,1967,1886,  0,643,1886],
    [  4,644,  0,1014,  4, 81,1886,1886,644, 16,1960,  0,1886],
    [  4,  4, 85,  4,  4,  0,1968,1886,1886,1886,1886,1963,1886],
    [1886,1970,  0,1970,1886,1967,643, 15,1963,  0,1886,1019,1886],
    [1886,  0,646,  0,1886,1886,1886,1886,  0,2070,1886, 16,1886],
    [1886,1012,2070,1012,1968, 21,2070, 15,1969,2070,1886,2070,1886],
    [1886,1886, 15,1886,1886,1886,1886,1886,1886,1886,1886,1964,1886],
    [1886,  0,1964,  0,1963, 15, 21,1962, 21,  0,1968,1014,1886],
    [1886, 22,2070,2070,2070,1886,  0,1886,1886, 81,1886,  0,1886],
    [1886, 22, 22, 22, 22,1886,1013,1886,1012,1964,1886, 87,1886],
    [1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886,1886]
],
    "bgmap": [

],
    "fgmap": [

],
    "bg2map": [

],
    "fg2map": [

]
}