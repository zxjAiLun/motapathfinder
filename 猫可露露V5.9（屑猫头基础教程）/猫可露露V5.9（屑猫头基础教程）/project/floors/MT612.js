main.floors.MT612=
{
    "floorId": "MT612",
    "title": "612 层",
    "name": "612 层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [
        {
            "name": "10.jpg",
            "canvas": "bg",
            "x": 0,
            "y": 0
        }
    ],
    "ratio": 50000000000,
    "defaultGround": 906,
    "bgm": "33.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,1": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,3": [
            {
                "type": "setValue",
                "name": "flag:door_MT612_6_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "5,4": [
            {
                "type": "setValue",
                "name": "flag:door_MT612_6_2",
                "operator": "+=",
                "value": "1"
            }
        ],
        "7,4": [
            {
                "type": "setValue",
                "name": "flag:door_MT612_6_2",
                "operator": "+=",
                "value": "1"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "6,2": {
            "0": {
                "condition": "flag:door_MT612_6_2==3",
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
                        "name": "flag:door_MT612_6_2",
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
    [908,908,908,908,908,  4,  4,  4,908,908,908,908,908],
    [908,644,908,  0,733,  4, 87,  4,1612,640,1614,  0,908],
    [908,1613,  0,1582,  0,  4, 85,  4,1010,908,  0,644,908],
    [908,908,908, 81,907,907,1413,907,  0,642,908,908,908],
    [908,1010,  0, 21,907,1414,  0,1415,907,1609,908,1011,908],
    [908,1611,908, 81,907,907, 86,907,1608,639,1609,1015,908],
    [908,1010,908, 21,  0,1610,  0,1610,  0, 81,908, 81,908],
    [908,  0,908,1606,908,  0, 22,908, 21,908,908,638,908],
    [908,639, 81,645,  0,1613,  0, 82,1611,  0,1608,  0,908],
    [908,1609,908,908,908, 22,908,908, 82,908,908, 82,908],
    [908, 21,  0, 15,1611,  0,1011,908,1010,  0,1606,  0,908],
    [908,  0,640,908,1015,908,  0,1607,  0, 22,908, 88,908],
    [908,908,908,908,908,908,908,908,908,908,908,908,908]
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