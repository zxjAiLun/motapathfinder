main.floors.F12=
{
    "floorId": "F12",
    "title": "心境 F12",
    "name": "心境 F12",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 5000000,
    "defaultGround": 1039,
    "bgm": "21.mp3",
    "weather": [
        "cloud",
        2
    ],
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {
        "11,11": [
            {
                "type": "setCurtain",
                "color": [
                    255,
                    255,
                    255,
                    1
                ],
                "time": 1000,
                "keep": true
            },
            {
                "type": "if",
                "condition": "(flag:xun==0)",
                "true": [
                    {
                        "type": "win",
                        "reason": "第六心境"
                    }
                ],
                "false": [
                    {
                        "type": "setValue",
                        "name": "status:hp",
                        "operator": "/=",
                        "value": "flag:xun"
                    },
                    {
                        "type": "win",
                        "reason": "第六心境"
                    }
                ]
            }
        ]
    },
    "changeFloor": {
        "1,9": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {},
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [183,183,183,183,183,183,183,183,183,183,183,183,183],
    [183,183,183, 15, 16,622,  0,621,183,  0,622,183,183],
    [183, 81,640,  0,183,183,621,  0, 16,621,  0,622,183],
    [183, 22,1266,183,183,183, 16,183,183,183,183,183,183],
    [183,1257,  0,183,183,183, 22,183,183,183,183,183,183],
    [183,  0,587,183,584,1266,  0,635, 81,621,1261,584,183],
    [183,620,183,183,183,620,183,183,183,183,183, 21,183],
    [183,1262,183,183,183,1262,183,183,183,183,183, 83,183],
    [183, 15, 15,621,183,641,183,183,183,183,  0,640,183],
    [183, 88,183,183,183,183,183,640,183,  4,1275,  4,  4],
    [183,  0,636,183,183,183,183,  0,621,  4, 31, 86,  4],
    [183,183,  0,635,1275,1014,1278,642,  0,1264, 86,995,  4],
    [183,183,183,183,183,183,183,183,183,  4,  4,  4,  4]
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