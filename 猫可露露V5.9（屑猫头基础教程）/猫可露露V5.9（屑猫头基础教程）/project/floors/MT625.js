main.floors.MT625=
{
    "floorId": "MT625",
    "title": "625 层",
    "name": "625 层",
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
    "firstArrive": [
        {
            "type": "hide",
            "loc": [
                [
                    6,
                    6
                ]
            ]
        }
    ],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        },
        "6,6": {
            "floorId": ":next",
            "stair": "downFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,8": [
            {
                "type": "setValue",
                "name": "flag:door_MT625_6_5",
                "operator": "+=",
                "value": "1"
            },
            {
                "type": "show",
                "loc": [
                    [
                        6,
                        6
                    ]
                ],
                "time": 1000
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {
        "6,5": {
            "0": {
                "condition": "flag:door_MT625_6_5==1",
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
                        "name": "flag:door_MT625_6_5",
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
    [907,907,907,907,907,907,907,907,907,907,907,907,907],
    [907,907,907,644,646,644,1012,643,1023,643,907,907,907],
    [907,907,907,907,639, 47,638, 50,640,907,907,907,907],
    [907,907,1019,1013,1019,1010,1438,1010,642,1014,642,907,907],
    [907,907,907,907,907,639,1011,640,907,907,907,907,907],
    [907,907,907,907,907,907, 85,907,907,907,907,907,907],
    [644,907,907,907,907,  4, 87,  4,907,907,907,907, 47],
    [  0,1623,1011,907,907,  4,  0,  4,907,907,643,1623,  0],
    [908,639,907,907,  4,  0,1588,  0,  4,907,907,642,908],
    [908,1622,907,907,907,  4,  0,  4,907,907,907,1622,908],
    [  0,644,  0,907,907,907, 86,907,907,907,  0, 50,  0],
    [642,  0,1620,1015,1621,639,  0,640,1621,1015,1620, 88, 50],
    [  0, 47,  0,908,908,  0,1010,  0,908,908,  0,1011,  0]
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